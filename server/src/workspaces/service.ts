import type pg from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { UserRole } from '../auth/types.js';
import {
  DEFAULT_DEPARTMENTS,
  MAX_ACTIVE_INVITES,
  MAX_CUSTOM_DEPARTMENTS,
  MAX_WORKSPACE_MEMBERS,
  isDefaultDepartment,
} from './limits.js';
import { generateInviteCode } from './invite-code.js';
import { slugCandidate, slugFromName } from './slug.js';
import type {
  AssignableRole,
  Department,
  Workspace,
  WorkspaceInvite,
  WorkspaceMemberSummary,
  WorkspaceSummary,
} from './types.js';

// Persistence for workspaces, members, invites, and departments. Raw SQL through the
// shared pool; anything that has to hold an invariant across statements (create a
// workspace and its owner, check a cap before inserting) runs inside a transaction.

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

function errorCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

function normalizeRole(role: string): UserRole {
  return role === 'owner' || role === 'admin' ? role : 'requester';
}

/**
 * Serializes concurrent writers for one workspace for the rest of the transaction.
 * Cap checks are read-then-write, so without this two simultaneous joins could both
 * observe 19 members and both insert. The lock is per-workspace, so unrelated
 * workspaces never contend.
 */
async function lockWorkspace(
  client: pg.PoolClient,
  workspaceId: string,
): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [
    workspaceId,
  ]);
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: Date;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

interface InviteRow {
  id: string;
  workspace_id: string;
  code: string;
  role: string;
  created_by: string | null;
  expires_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
  is_reusable: boolean;
  created_at: Date;
}

function rowToInvite(row: InviteRow): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    code: row.code,
    role: row.role === 'admin' ? 'admin' : 'requester',
    createdBy: row.created_by,
    expiresAt: row.expires_at?.toISOString() ?? null,
    usedAt: row.used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    isReusable: row.is_reusable,
    createdAt: row.created_at.toISOString(),
  };
}

const INVITE_COLUMNS = `id, workspace_id, code, role, created_by,
    expires_at, used_at, revoked_at, is_reusable, created_at`;

// --- Workspaces -------------------------------------------------------------

/** Looks up a workspace by its public slug. */
export async function getWorkspaceBySlug(
  slug: string,
): Promise<Workspace | null> {
  const { rows } = await pool.query<WorkspaceRow>(
    `select id, name, slug, created_by, created_at
       from workspaces
      where slug = $1`,
    [slug],
  );
  const row = rows[0];
  return row ? rowToWorkspace(row) : null;
}

/** Every workspace the user belongs to, with their role in each. */
export async function listUserWorkspaces(
  userId: string,
): Promise<WorkspaceSummary[]> {
  const { rows } = await pool.query<WorkspaceRow & { role: string; joined_at: Date }>(
    `select w.id, w.name, w.slug, w.created_by, w.created_at,
            m.role, m.created_at as joined_at
       from workspace_members m
       join workspaces w on w.id = m.workspace_id
      where m.user_id = $1
      order by m.created_at asc`,
    [userId],
  );
  return rows.map((row) => ({
    ...rowToWorkspace(row),
    role: normalizeRole(row.role),
    joinedAt: row.joined_at.toISOString(),
  }));
}

/** How many workspaces the user owns. Drives MAX_WORKSPACES_PER_USER. */
export async function countOwnedWorkspaces(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from workspace_members
      where user_id = $1 and role = 'owner'`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Creates a workspace, makes the caller its owner, and seeds the default departments
 * — all in one transaction, so a workspace can never exist without an owner. The slug
 * is derived from the name; if it is taken, the next candidate (`name-2`, `name-3`, …)
 * is tried. Racing on the unique index rather than checking first keeps it correct
 * under concurrency.
 */
export async function createWorkspaceWithOwner(
  name: string,
  userId: string,
): Promise<WorkspaceSummary> {
  const base = slugFromName(name);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = slugCandidate(base, attempt);
    try {
      return await withTransaction(async (client) => {
        const { rows } = await client.query<WorkspaceRow>(
          `insert into workspaces (name, slug, created_by)
           values ($1, $2, $3)
           returning id, name, slug, created_by, created_at`,
          [name, slug, userId],
        );
        // insert ... returning always yields exactly one row on success.
        const workspace = rowToWorkspace(rows[0] as WorkspaceRow);

        const member = await client.query<{ created_at: Date }>(
          `insert into workspace_members (workspace_id, user_id, role)
           values ($1, $2, 'owner')
           returning created_at`,
          [workspace.id, userId],
        );

        await client.query(
          `insert into departments (workspace_id, id, name, description)
           select $1, d.id, d.name, d.description
             from unnest($2::text[], $3::text[], $4::text[])
                  as d(id, name, description)`,
          [
            workspace.id,
            DEFAULT_DEPARTMENTS.map((d) => d.id),
            DEFAULT_DEPARTMENTS.map((d) => d.name),
            DEFAULT_DEPARTMENTS.map((d) => d.description),
          ],
        );

        return {
          ...workspace,
          role: 'owner' as const,
          joinedAt: (
            member.rows[0]?.created_at ?? new Date()
          ).toISOString(),
        };
      });
    } catch (err) {
      // Slug collision: try the next candidate. Anything else is a real failure.
      if (errorCode(err) !== UNIQUE_VIOLATION) throw err;
    }
  }

  throw new ConflictError(
    'Could not find an available workspace address for that name. Try a different name.',
  );
}

/** Deletes a workspace. Cascades to every workspace-scoped row via the schema. */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const { rowCount } = await pool.query(`delete from workspaces where id = $1`, [
    workspaceId,
  ]);
  if (!rowCount) throw new NotFoundError('Workspace not found.');
}

// --- Members ----------------------------------------------------------------

/** All members of a workspace, with the identity fields the UI shows. */
export async function listMembers(
  workspaceId: string,
): Promise<WorkspaceMemberSummary[]> {
  const { rows } = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    created_at: Date;
  }>(
    `select m.user_id, m.role, m.created_at, u.email, u.display_name
       from workspace_members m
       join users u on u.id = m.user_id
      where m.workspace_id = $1
      order by m.created_at asc`,
    [workspaceId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name || row.email,
    role: normalizeRole(row.role),
    joinedAt: row.created_at.toISOString(),
  }));
}

/** Sets a member's role. Returns false when the membership no longer exists. */
export async function updateMemberRole(
  workspaceId: string,
  memberUserId: string,
  role: AssignableRole,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update workspace_members set role = $3
      where workspace_id = $1 and user_id = $2`,
    [workspaceId, memberUserId, role],
  );
  return rowCount === 1;
}

/** Removes a membership. Returns false when it no longer exists. */
export async function removeMember(
  workspaceId: string,
  memberUserId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from workspace_members where workspace_id = $1 and user_id = $2`,
    [workspaceId, memberUserId],
  );
  return rowCount === 1;
}

// --- Invites ----------------------------------------------------------------

/** Every invite for a workspace, newest first. */
export async function listInvites(
  workspaceId: string,
): Promise<WorkspaceInvite[]> {
  const { rows } = await pool.query<InviteRow>(
    `select ${INVITE_COLUMNS}
       from workspace_invites
      where workspace_id = $1
      order by created_at desc`,
    [workspaceId],
  );
  return rows.map(rowToInvite);
}

/** Looks up one invite scoped to its workspace. */
export async function getInviteById(
  workspaceId: string,
  inviteId: string,
): Promise<WorkspaceInvite | null> {
  const { rows } = await pool.query<InviteRow>(
    `select ${INVITE_COLUMNS}
       from workspace_invites
      where workspace_id = $1 and id = $2`,
    [workspaceId, inviteId],
  );
  const row = rows[0];
  return row ? rowToInvite(row) : null;
}

// An invite is "active" in SQL under the same conditions as rules.isInviteActive.
// Kept as a fragment so the cap query and the redemption lookup can't drift apart.
const ACTIVE_INVITE_PREDICATE = `revoked_at is null
      and (expires_at is null or expires_at > now())
      and (is_reusable or used_at is null)`;

/**
 * Mints an invite. The active-invite cap and the member cap are both checked inside
 * the transaction under the workspace lock, so concurrent admins can't overshoot.
 */
export async function createInvite(input: {
  workspaceId: string;
  createdBy: string;
  role: AssignableRole;
  isReusable: boolean;
  expiresInDays: number;
}): Promise<WorkspaceInvite> {
  return withTransaction(async (client) => {
    await lockWorkspace(client, input.workspaceId);

    const memberCount = await countRows(
      client,
      `select count(*)::text as count from workspace_members where workspace_id = $1`,
      [input.workspaceId],
    );
    if (memberCount >= MAX_WORKSPACE_MEMBERS) {
      throw new ConflictError(
        `This workspace is full (${MAX_WORKSPACE_MEMBERS} members). Remove a member before inviting someone new.`,
      );
    }

    const activeCount = await countRows(
      client,
      `select count(*)::text as count from workspace_invites
        where workspace_id = $1 and ${ACTIVE_INVITE_PREDICATE}`,
      [input.workspaceId],
    );
    if (activeCount >= MAX_ACTIVE_INVITES) {
      throw new ConflictError(
        `You can have up to ${MAX_ACTIVE_INVITES} active invites. Revoke or delete one to create another.`,
      );
    }

    // The unique index on code is the real guard; retry on the (vanishingly rare)
    // collision rather than pre-checking.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const { rows } = await client.query<InviteRow>(
          `insert into workspace_invites
             (workspace_id, code, role, created_by, expires_at, is_reusable)
           values ($1, $2, $3, $4,
                   case when $5::int = 0 then null
                        else now() + make_interval(days => $5::int) end,
                   $6)
           returning ${INVITE_COLUMNS}`,
          [
            input.workspaceId,
            generateInviteCode(),
            input.role,
            input.createdBy,
            input.expiresInDays,
            input.isReusable,
          ],
        );
        return rowToInvite(rows[0] as InviteRow);
      } catch (err) {
        if (errorCode(err) !== UNIQUE_VIOLATION) throw err;
      }
    }
    throw new ConflictError('Could not generate an invite code. Try again.');
  });
}

/** Marks an invite revoked. Returns false when it is already revoked or missing. */
export async function revokeInvite(
  workspaceId: string,
  inviteId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update workspace_invites set revoked_at = now()
      where workspace_id = $1 and id = $2 and revoked_at is null`,
    [workspaceId, inviteId],
  );
  return rowCount === 1;
}

/** Deletes an invite outright. Returns false when it no longer exists. */
export async function deleteInvite(
  workspaceId: string,
  inviteId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from workspace_invites where workspace_id = $1 and id = $2`,
    [workspaceId, inviteId],
  );
  return rowCount === 1;
}

export interface RedeemResult {
  workspace: Workspace;
  role: UserRole;
  /** True when the caller was already a member and the invite was left untouched. */
  alreadyMember: boolean;
}

/**
 * Redeems an invite code and joins the caller to the workspace. Runs as one
 * transaction under the workspace lock: the invite is re-validated, the member cap is
 * enforced, the membership is inserted, and a single-use code is burned — so two
 * people racing on the last seat (or on the same one-shot code) cannot both win.
 *
 * Redeeming a code for a workspace the caller already belongs to is a no-op that
 * reports success without consuming the invite.
 */
export async function redeemInvite(
  code: string,
  userId: string,
): Promise<RedeemResult | null> {
  return withTransaction(async (client) => {
    const invited = await client.query<InviteRow>(
      `select ${INVITE_COLUMNS} from workspace_invites where code = $1 for update`,
      [code],
    );
    const inviteRow = invited.rows[0];
    // Unknown code and dead code are indistinguishable to the caller by design.
    if (!inviteRow) return null;
    const invite = rowToInvite(inviteRow);

    await lockWorkspace(client, invite.workspaceId);

    const active = await client.query<{ ok: boolean }>(
      `select true as ok from workspace_invites
        where id = $1 and ${ACTIVE_INVITE_PREDICATE}`,
      [invite.id],
    );
    if (!active.rows[0]) return null;

    const workspaceRows = await client.query<WorkspaceRow>(
      `select id, name, slug, created_by, created_at from workspaces where id = $1`,
      [invite.workspaceId],
    );
    const workspaceRow = workspaceRows.rows[0];
    if (!workspaceRow) return null;
    const workspace = rowToWorkspace(workspaceRow);

    const existing = await client.query<{ role: string }>(
      `select role from workspace_members where workspace_id = $1 and user_id = $2`,
      [workspace.id, userId],
    );
    const existingRole = existing.rows[0];
    if (existingRole) {
      return {
        workspace,
        role: normalizeRole(existingRole.role),
        alreadyMember: true,
      };
    }

    const memberCount = await countRows(
      client,
      `select count(*)::text as count from workspace_members where workspace_id = $1`,
      [workspace.id],
    );
    if (memberCount >= MAX_WORKSPACE_MEMBERS) {
      throw new ConflictError(
        `This workspace is full (${MAX_WORKSPACE_MEMBERS} members). Ask an admin to remove a member, then try again.`,
      );
    }

    await client.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`,
      [workspace.id, userId, invite.role],
    );

    if (!invite.isReusable) {
      await client.query(
        `update workspace_invites set used_at = now() where id = $1`,
        [invite.id],
      );
    }

    return { workspace, role: invite.role, alreadyMember: false };
  });
}

// --- Departments ------------------------------------------------------------

/** Departments in a workspace, defaults flagged so the UI can hide delete on them. */
export async function listDepartments(
  workspaceId: string,
): Promise<Department[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    description: string;
  }>(
    `select id, name, description
       from departments
      where workspace_id = $1
      order by name asc`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: isDefaultDepartment(row.id),
  }));
}

/**
 * Adds a department. Only custom ids count against MAX_CUSTOM_DEPARTMENTS, so
 * re-adding a previously deleted default never eats the budget.
 */
export async function createDepartment(
  workspaceId: string,
  input: { id: string; name: string; description: string },
): Promise<Department> {
  return withTransaction(async (client) => {
    await lockWorkspace(client, workspaceId);

    if (!isDefaultDepartment(input.id)) {
      const customCount = await countRows(
        client,
        `select count(*)::text as count from departments
          where workspace_id = $1 and not (id = any($2::text[]))`,
        [workspaceId, [...DEFAULT_DEPARTMENTS.map((d) => d.id)]],
      );
      if (customCount >= MAX_CUSTOM_DEPARTMENTS) {
        throw new ConflictError(
          `You can create up to ${MAX_CUSTOM_DEPARTMENTS} custom departments. Delete one to add another.`,
        );
      }
    }

    try {
      const { rows } = await client.query<{
        id: string;
        name: string;
        description: string;
      }>(
        `insert into departments (workspace_id, id, name, description)
         values ($1, $2, $3, $4)
         returning id, name, description`,
        [workspaceId, input.id, input.name, input.description],
      );
      const row = rows[0] as { id: string; name: string; description: string };
      return { ...row, isDefault: isDefaultDepartment(row.id) };
    } catch (err) {
      if (errorCode(err) === UNIQUE_VIOLATION) {
        throw new ConflictError(
          `A department with the ID "${input.id}" already exists.`,
        );
      }
      throw err;
    }
  });
}

/** Updates a department's name and/or description. */
export async function updateDepartment(
  workspaceId: string,
  id: string,
  input: { name?: string; description?: string },
): Promise<Department | null> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    description: string;
  }>(
    `update departments
        set name = coalesce($3, name),
            description = coalesce($4, description)
      where workspace_id = $1 and id = $2
      returning id, name, description`,
    [workspaceId, id, input.name ?? null, input.description ?? null],
  );
  const row = rows[0];
  return row ? { ...row, isDefault: isDefaultDepartment(row.id) } : null;
}

/**
 * Deletes a custom department. Tickets and triage results foreign-key to
 * (workspace_id, department), so a department still in use is rejected with a 409
 * rather than surfacing a raw constraint error.
 */
export async function deleteDepartment(
  workspaceId: string,
  id: string,
): Promise<boolean> {
  try {
    const { rowCount } = await pool.query(
      `delete from departments where workspace_id = $1 and id = $2`,
      [workspaceId, id],
    );
    return rowCount === 1;
  } catch (err) {
    if (errorCode(err) === FOREIGN_KEY_VIOLATION) {
      throw new ConflictError(
        'This department is still referenced by tickets or triage results.',
      );
    }
    throw err;
  }
}

// --- helpers ----------------------------------------------------------------

async function countRows(
  client: Queryable,
  sql: string,
  params: unknown[],
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}
