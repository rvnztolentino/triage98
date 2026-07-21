import type pg from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { BadRequestError } from '../lib/errors.js';
import { REQUEST_ID_PREFIX, REQUEST_ID_START } from './limits.js';
import {
  commitAttachment,
  discardFiles,
  resolveStoragePath,
  storagePathFor,
} from './attachments.js';
import type {
  PendingAttachment,
  RequestAttachment,
  RequestDetail,
  RequestPage,
  RequestStatus,
  RequestSummary,
} from './types.js';

// Persistence for requests and their attachments. Raw SQL through the shared pool,
// same as workspaces/service.ts. Every function here takes a workspaceId that the
// caller has already had verified by requireWorkspace — this layer scopes its queries
// by it but does not decide who may pass it in.

interface RequestRow {
  id: string;
  workspace_id: string;
  requester_user_id: string | null;
  description: string;
  location: string;
  contact_name: string;
  urgency_note: string;
  status: string;
  duplicate_of_ticket_id: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  requester_name: string | null;
  requester_email: string | null;
  attachment_count: string;
}

function normalizeStatus(status: string): RequestStatus {
  return status === 'approved' ||
    status === 'rejected' ||
    status === 'duplicate'
    ? status
    : 'needs-review';
}

function rowToSummary(row: RequestRow): RequestSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    requesterUserId: row.requester_user_id,
    // A deleted user leaves the row behind with a null requester; the submission is
    // still part of the workspace's history, so it gets a name rather than a blank.
    requesterName:
      row.requester_name || row.requester_email || 'Former member',
    description: row.description,
    location: row.location,
    contactName: row.contact_name,
    urgencyNote: row.urgency_note,
    status: normalizeStatus(row.status),
    duplicateOfTicketId: row.duplicate_of_ticket_id,
    attachmentCount: Number(row.attachment_count ?? 0),
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  };
}

// Selecting the requester's identity and the attachment count alongside the row keeps
// listings to a single round-trip; the counts come from a lateral rather than a group
// by so the request columns don't all have to be repeated.
const REQUEST_SELECT = `select r.id, r.workspace_id, r.requester_user_id, r.description,
            r.location, r.contact_name, r.urgency_note, r.status,
            r.duplicate_of_ticket_id, r.created_at, r.reviewed_at,
            u.display_name as requester_name, u.email as requester_email,
            a.count::text as attachment_count
       from requests r
       left join users u on u.id = r.requester_user_id
       left join lateral (
         select count(*) as count
           from request_attachments att
          where att.workspace_id = r.workspace_id and att.request_id = r.id
       ) a on true`;

interface AttachmentRow {
  id: string;
  request_id: string;
  file_name: string;
  content_type: string;
  size_bytes: string;
  created_at: Date;
  storage_path: string;
}

function rowToAttachment(
  row: AttachmentRow,
  workspaceSlug: string,
): RequestAttachment {
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    // The client gets a URL it can fetch, never the storage path — where the bytes
    // live on disk is this server's business.
    url: `/workspaces/${workspaceSlug}/requests/${row.request_id}/attachments/${row.id}`,
  };
}

/**
 * Allocates the next human-readable request id (REQ-1001, REQ-1002, …).
 *
 * A max-plus-one read is only safe because the caller holds an advisory lock for the
 * duration of the transaction. A Postgres sequence would avoid the lock, but it would
 * also mean a schema change on a database that auto-applies its schema exactly once,
 * on first boot — and gapless, readable ids are worth more here than the contention
 * saved on a workload of a few submissions a minute.
 */
async function nextRequestId(client: pg.PoolClient): Promise<string> {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [
    'triage98:request-id',
  ]);
  const { rows } = await client.query<{ next: string }>(
    `select coalesce(max(substring(id from '^${REQUEST_ID_PREFIX}-([0-9]+)$')::bigint), $1) + 1 as next
       from requests
      where id ~ '^${REQUEST_ID_PREFIX}-[0-9]+$'`,
    [REQUEST_ID_START],
  );
  return `${REQUEST_ID_PREFIX}-${rows[0]?.next ?? REQUEST_ID_START + 1}`;
}

export interface CreateRequestInput {
  workspaceId: string;
  /** Only used to build attachment URLs; scoping is always by workspaceId. */
  workspaceSlug: string;
  requesterUserId: string;
  /** The submitter's display name, so the response doesn't need a second query. */
  requesterName: string;
  description: string;
  location: string;
  contactName: string;
  urgencyNote: string;
  attachments: readonly PendingAttachment[];
}

/**
 * Saves a request and its attachments as one unit.
 *
 * Files are moved into place inside the transaction: if a move fails the transaction
 * rolls back and the moved files are removed, so there is never a request row pointing
 * at a file that isn't there. The reverse leak — a file on disk with no row — is
 * possible only if the process dies between the last rename and the commit, and is
 * harmless by comparison.
 */
export async function createRequest(
  input: CreateRequestInput,
): Promise<RequestDetail> {
  const moved: string[] = [];

  try {
    return await withTransaction(async (client) => {
      const id = await nextRequestId(client);

      const { rows } = await client.query<RequestRow>(
        `insert into requests
           (id, workspace_id, requester_user_id, description, location,
            contact_name, urgency_note, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'needs-review')
         returning id, workspace_id, requester_user_id, description, location,
                   contact_name, urgency_note, status, duplicate_of_ticket_id,
                   created_at, reviewed_at,
                   null::text as requester_name, null::text as requester_email,
                   '0' as attachment_count`,
        [
          id,
          input.workspaceId,
          input.requesterUserId,
          input.description,
          input.location,
          input.contactName,
          input.urgencyNote,
        ],
      );
      const request = rowToSummary(rows[0] as RequestRow);

      const attachments: AttachmentRow[] = [];
      for (const file of input.attachments) {
        const storagePath = storagePathFor(input.workspaceId, id, file.fileName);
        await commitAttachment(file.tempPath, storagePath);
        moved.push(resolveStoragePath(storagePath));

        const saved = await client.query<AttachmentRow>(
          `insert into request_attachments
             (workspace_id, request_id, file_name, storage_path, content_type, size_bytes)
           values ($1, $2, $3, $4, $5, $6)
           returning id, request_id, file_name, content_type,
                     size_bytes::text, created_at, storage_path`,
          [
            input.workspaceId,
            id,
            file.fileName,
            storagePath,
            file.contentType,
            file.sizeBytes,
          ],
        );
        attachments.push(saved.rows[0] as AttachmentRow);
      }

      return {
        ...request,
        requesterName: input.requesterName,
        attachmentCount: attachments.length,
        attachments: attachments.map((row) =>
          rowToAttachment(row, input.workspaceSlug),
        ),
      };
    });
  } catch (err) {
    // The transaction is already rolled back; drop the files it referenced so a
    // failed submission doesn't leave bytes on disk nothing points to.
    await discardFiles(moved);
    throw err;
  }
}

export interface ListRequestsOptions {
  workspaceId: string;
  /** Set for requesters — the scoping that keeps them to their own submissions. */
  requesterUserId?: string;
  status?: RequestStatus;
  limit: number;
  cursor?: string;
}

/**
 * Lists requests newest first, keyset-paginated.
 *
 * Ordering is (created_at desc, id desc) and the cursor carries both, because two
 * requests submitted in the same millisecond would otherwise let an offset-based page
 * boundary skip or repeat a row.
 */
export async function listRequests(
  options: ListRequestsOptions,
): Promise<RequestPage> {
  const params: unknown[] = [options.workspaceId];
  const where = ['r.workspace_id = $1'];

  if (options.requesterUserId) {
    params.push(options.requesterUserId);
    where.push(`r.requester_user_id = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    where.push(`r.status = $${params.length}`);
  }
  if (options.cursor) {
    const { createdAt, id } = decodeCursor(options.cursor);
    params.push(createdAt, id);
    where.push(
      `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length})`,
    );
  }

  // One row over the page size answers "is there another page?" without a count.
  params.push(options.limit + 1);

  const { rows } = await pool.query<RequestRow>(
    `${REQUEST_SELECT}
      where ${where.join(' and ')}
      order by r.created_at desc, r.id desc
      limit $${params.length}`,
    params,
  );

  const page = rows.slice(0, options.limit).map(rowToSummary);
  const last = page[page.length - 1];
  return {
    requests: page,
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor(last.createdAt, last.id)
        : null,
  };
}

/** One request with its attachments, or null when it isn't in this workspace. */
export async function getRequest(
  workspaceId: string,
  requestId: string,
  workspaceSlug: string,
): Promise<RequestDetail | null> {
  const { rows } = await pool.query<RequestRow>(
    `${REQUEST_SELECT} where r.workspace_id = $1 and r.id = $2`,
    [workspaceId, requestId],
  );
  const row = rows[0];
  if (!row) return null;

  const attachments = await pool.query<AttachmentRow>(
    `select id, request_id, file_name, content_type, size_bytes::text,
            created_at, storage_path
       from request_attachments
      where workspace_id = $1 and request_id = $2
      order by created_at asc`,
    [workspaceId, requestId],
  );

  return {
    ...rowToSummary(row),
    attachments: attachments.rows.map((attachment) =>
      rowToAttachment(attachment, workspaceSlug),
    ),
  };
}

export interface StoredAttachment {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
}

/** Looks up one attachment, scoped to its workspace and parent request. */
export async function getAttachment(
  workspaceId: string,
  requestId: string,
  attachmentId: string,
): Promise<StoredAttachment | null> {
  const { rows } = await pool.query<AttachmentRow>(
    `select id, request_id, file_name, content_type, size_bytes::text,
            created_at, storage_path
       from request_attachments
      where workspace_id = $1 and request_id = $2 and id = $3`,
    [workspaceId, requestId, attachmentId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
  };
}

// --- cursors ----------------------------------------------------------------

/** Encodes the sort key of the last row on a page into an opaque cursor. */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decodes a cursor back into its sort key. A cursor is echoed back from a previous
 * response, so a malformed one is a client bug — reported as a 400 rather than being
 * silently ignored, which would quietly hand back page one forever.
 */
export function decodeCursor(cursor: string): {
  createdAt: string;
  id: string;
} {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (separator < 1 || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new BadRequestError('Invalid page cursor.');
  }
  return { createdAt, id };
}
