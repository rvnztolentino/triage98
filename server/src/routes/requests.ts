import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Router, type Request } from 'express';
import { NotFoundError } from '../lib/errors.js';
import { routeParam } from '../lib/params.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/authenticate.js';
import {
  rateLimit,
  userWorkspaceKey,
  workspaceKey,
} from '../middleware/rate-limit.js';
import { uploadAttachments } from '../middleware/upload.js';
import { requireWorkspace } from '../middleware/workspace.js';
import { enqueueTriageJob } from '../queue/triage-queue.js';
import { isAdmin } from '../auth/access.js';
import { assertWorkspaceMutable } from '../workspaces/limits.js';
import {
  assertSignatureMatches,
  discardFiles,
  resolveContentType,
  resolveStoragePath,
  sanitizeFileName,
} from '../requests/attachments.js';
import {
  requestCreateSchema,
  requestListQuerySchema,
} from '../requests/schemas.js';
import {
  createRequest,
  getAttachment,
  getRequest,
  listRequests,
} from '../requests/service.js';
import type { PendingAttachment } from '../requests/types.js';
import type { AppUser } from '../auth/types.js';
import type { WorkspaceAccess } from '../auth/access.js';

// Requests: the front door of the product. Someone describes a problem in their own
// words, attaches a photo of it, and it lands in the review queue.
//
// Mounted at /workspaces/:slug/requests, so mergeParams is required to see the slug.
// Every route runs requireWorkspace, which resolves that slug through the
// access-control choke point — nothing below queries workspace_members.
const router = Router({ mergeParams: true });

router.use(requireAuth);

function actor(req: Request): AppUser {
  const user = req.user;
  if (!user) throw new Error('requireAuth did not run for this route');
  return user;
}

function scope(req: Request): WorkspaceAccess {
  const workspace = req.workspace;
  const membership = req.membership;
  if (!workspace || !membership) {
    throw new Error('requireWorkspace did not run for this route');
  }
  return { workspace, membership };
}

/**
 * Requesters see only what they filed; admins and owners see the whole queue. This
 * one helper is the entirety of requester-scoped visibility — returning undefined
 * means "no requester filter", which is a privilege, so it is derived from the
 * verified membership role and never from anything the caller sends.
 */
function requesterScope(req: Request): string | undefined {
  const { membership } = scope(req);
  return isAdmin(membership.role) ? undefined : actor(req).id;
}

// Submissions are throttled per user per workspace, and the workspace as a whole has
// a daily ceiling: one enthusiastic user shouldn't be able to fill a small team's
// review queue, and neither should one workspace fill the disk.
const submitLimiter = rateLimit({
  name: 'request:submit',
  limit: 20,
  windowSeconds: 60 * 60,
  key: userWorkspaceKey,
});
const workspaceSubmitLimiter = rateLimit({
  name: 'request:submit:workspace',
  limit: 200,
  windowSeconds: 60 * 60 * 24,
  key: workspaceKey,
});

/** Temp files multer wrote for this request, whatever happens next. */
function tempPaths(req: Request): string[] {
  return Array.isArray(req.files) ? req.files.map((file) => file.path) : [];
}

// POST /workspaces/:slug/requests — submit a request, with up to five attachments.
router.post(
  '/',
  requireWorkspace(),
  submitLimiter,
  workspaceSubmitLimiter,
  uploadAttachments(),
  async (req, res) => {
    const { workspace } = scope(req);
    const user = actor(req);

    try {
      assertWorkspaceMutable(workspace.id);
      const input = parseBody(requestCreateSchema, req.body);

      // Multipart fields and files are validated separately: multer's fileFilter has
      // already checked the declared type, and this is where the bytes get checked
      // against it. A renamed executable fails here, not on someone's machine later.
      const files = Array.isArray(req.files) ? req.files : [];
      const attachments: PendingAttachment[] = [];
      for (const file of files) {
        const fileName = sanitizeFileName(file.originalname);
        await assertSignatureMatches(file.path, fileName, file.size);
        attachments.push({
          fileName,
          contentType: resolveContentType(file.originalname, file.mimetype),
          sizeBytes: file.size,
          tempPath: file.path,
        });
      }

      const created = await createRequest({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        requesterUserId: user.id,
        requesterName: user.displayName || user.email,
        description: input.description,
        location: input.location,
        // Falling back to the submitter's own name means the field can be left blank
        // by the common case — you are usually reporting your own problem.
        contactName: input.contactName || user.displayName || user.email,
        urgencyNote: input.urgencyNote,
        attachments,
      });

      // Triage is best-effort by design: a request that was saved but not queued is
      // still in the review queue for a human. AI-down is not app-down.
      const queued = await enqueueTriageJob(workspace.id, created.id);

      res.status(201).json({ request: created, queuedForTriage: queued });
    } catch (err) {
      // Anything that failed above leaves temp files behind; createRequest cleans up
      // what it moved, and this cleans up what never got that far.
      await discardFiles(tempPaths(req));
      throw err;
    }
  },
);

// GET /workspaces/:slug/requests — the review queue, or your own submissions.
router.get('/', requireWorkspace(), async (req, res) => {
  const { workspace } = scope(req);
  const query = parseBody(requestListQuerySchema, req.query);
  const scopedTo = requesterScope(req);

  const page = await listRequests({
    workspaceId: workspace.id,
    // A requester's own id always wins over the filter they asked for; an admin may
    // narrow the queue to one person.
    requesterUserId: scopedTo ?? query.requesterUserId,
    status: query.status,
    limit: query.limit,
    cursor: query.cursor,
  });

  res.json(page);
});

// GET /workspaces/:slug/requests/:requestId — one request with its attachments.
router.get('/:requestId', requireWorkspace(), async (req, res) => {
  const { workspace } = scope(req);
  const request = await getRequest(
    workspace.id,
    routeParam(req, 'requestId'),
    workspace.slug,
  );

  // Request ids are sequential and therefore guessable, so a requester asking for
  // someone else's gets the same 404 as one that doesn't exist.
  const scopedTo = requesterScope(req);
  if (!request || (scopedTo && request.requesterUserId !== scopedTo)) {
    throw new NotFoundError('Request not found.');
  }

  res.json({ request });
});

// GET /workspaces/:slug/requests/:requestId/attachments/:attachmentId — the bytes.
router.get(
  '/:requestId/attachments/:attachmentId',
  requireWorkspace(),
  async (req, res) => {
    const { workspace } = scope(req);
    const requestId = routeParam(req, 'requestId');

    // The parent request is fetched first so the attachment inherits exactly the
    // visibility rules of the request it belongs to.
    const request = await getRequest(workspace.id, requestId, workspace.slug);
    const scopedTo = requesterScope(req);
    if (!request || (scopedTo && request.requesterUserId !== scopedTo)) {
      throw new NotFoundError('Attachment not found.');
    }

    const attachment = await getAttachment(
      workspace.id,
      requestId,
      routeParam(req, 'attachmentId'),
    );
    if (!attachment) throw new NotFoundError('Attachment not found.');

    const absolute = resolveStoragePath(attachment.storagePath);
    // A row without its file means someone moved the upload directory out from under
    // us. Report it as missing rather than streaming a broken response.
    const stats = await stat(absolute).catch(() => null);
    if (!stats?.isFile()) {
      throw new NotFoundError('Attachment file is no longer available.');
    }

    res.setHeader('Content-Type', attachment.contentType);
    res.setHeader('Content-Length', String(stats.size));
    // Always an attachment, never inline: this serves user-supplied files from the
    // API's own origin, and nothing here should be rendered in that context.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeFileName(attachment.fileName)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(absolute).pipe(res);
  },
);

export default router;
