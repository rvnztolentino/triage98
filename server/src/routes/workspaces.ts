import { Router, type Request } from 'express';
import { assertCleanName } from '../lib/display-name.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../lib/errors.js';
import { routeParam } from '../lib/params.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/authenticate.js';
import {
  rateLimit,
  userKey,
  userWorkspaceKey,
} from '../middleware/rate-limit.js';
import { requireWorkspace } from '../middleware/workspace.js';
import { normalizeInviteCode } from '../workspaces/invite-code.js';
import {
  MAX_WORKSPACES_PER_USER,
  assertWorkspaceMutable,
  isDefaultDepartment,
} from '../workspaces/limits.js';
import {
  canCreateInvite,
  canManageInvite,
  canRemoveMember,
  canUpdateMemberRole,
} from '../workspaces/rules.js';
import {
  countOwnedWorkspaces,
  createDepartment,
  createInvite,
  createWorkspaceWithOwner,
  deleteDepartment,
  deleteInvite,
  deleteWorkspace,
  getInviteById,
  listDepartments,
  listInvites,
  listMembers,
  listUserWorkspaces,
  redeemInvite,
  removeMember,
  revokeInvite,
  updateDepartment,
  updateMemberRole,
} from '../workspaces/service.js';
import {
  departmentCreateSchema,
  departmentUpdateSchema,
  inviteCreateSchema,
  inviteRedeemSchema,
  memberRoleUpdateSchema,
  workspaceCreateSchema,
  workspaceDeleteSchema,
} from '../workspaces/schemas.js';
import type { AppUser } from '../auth/types.js';
import type { WorkspaceAccess } from '../auth/access.js';

const router = Router();

// Every route here is authenticated, and every workspace-scoped one additionally
// passes through requireWorkspace(role) — the guard that resolves the :slug through
// auth/access.ts. Handlers below therefore never query workspace_members themselves;
// they read req.membership and apply the policy functions in workspaces/rules.ts.
router.use(requireAuth);

// req.user / req.workspace are typed optional (the augmentation can't know which
// guards a route ran). These narrow once, so handlers aren't littered with `!`.
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

// Workspace creation and invite redemption are the two ways a user's footprint grows,
// so both are throttled per user rather than per workspace.
const createWorkspaceLimiter = rateLimit({
  name: 'workspace:create',
  limit: 5,
  windowSeconds: 60 * 60,
  key: userKey,
});
const joinLimiter = rateLimit({
  name: 'workspace:join',
  limit: 10,
  windowSeconds: 60 * 10,
  key: userKey,
});
// Admin mutations are throttled per user per workspace, per the architecture notes.
const adminLimiter = rateLimit({
  name: 'workspace:admin',
  limit: 60,
  windowSeconds: 60,
  key: userWorkspaceKey,
});

// --- Workspaces -------------------------------------------------------------

// GET /workspaces — every workspace the caller belongs to.
router.get('/', async (req, res) => {
  const workspaces = await listUserWorkspaces(actor(req).id);
  res.json({ workspaces });
});

// POST /workspaces — create a workspace and become its owner.
router.post('/', createWorkspaceLimiter, async (req, res) => {
  const user = actor(req);
  const input = parseBody(workspaceCreateSchema, req.body);
  const name = assertCleanName(input.name, {
    label: 'Workspace name',
    maxLength: 80,
  });

  const owned = await countOwnedWorkspaces(user.id);
  if (owned >= MAX_WORKSPACES_PER_USER) {
    throw new ConflictError(
      `You can create up to ${MAX_WORKSPACES_PER_USER} workspaces. Delete one to create another.`,
    );
  }

  const workspace = await createWorkspaceWithOwner(name, user.id);
  res.status(201).json({ workspace });
});

// POST /workspaces/join — redeem an invite code (or a pasted invite link).
router.post('/join', joinLimiter, async (req, res) => {
  const input = parseBody(inviteRedeemSchema, req.body);
  const code = normalizeInviteCode(input.code);
  const result = await redeemInvite(code, actor(req).id);
  if (!result) {
    // Unknown, expired, revoked, and already-used codes are one message: an invite
    // code is a bearer credential, and the response shouldn't confirm which exist.
    throw new NotFoundError("That invite code doesn't exist or is no longer valid.");
  }
  res.status(result.alreadyMember ? 200 : 201).json(result);
});

// GET /workspaces/:slug — workspace detail plus the caller's own role.
router.get('/:slug', requireWorkspace(), (req, res) => {
  const { workspace, membership } = scope(req);
  res.json({ workspace, role: membership.role });
});

// DELETE /workspaces/:slug — owner only, slug retyped as confirmation.
router.delete('/:slug', requireWorkspace('owner'), async (req, res) => {
  const { workspace } = scope(req);
  assertWorkspaceMutable(workspace.id);
  const input = parseBody(workspaceDeleteSchema, req.body);
  if (input.confirmation !== workspace.slug) {
    throw new BadRequestError(
      `Enter ${workspace.slug} to confirm permanent deletion.`,
    );
  }
  await deleteWorkspace(workspace.id);
  res.status(204).end();
});

// --- Members ----------------------------------------------------------------

// GET /workspaces/:slug/members — any member may see who else is here.
router.get('/:slug/members', requireWorkspace(), async (req, res) => {
  const members = await listMembers(scope(req).workspace.id);
  res.json({ members });
});

// POST /workspaces/:slug/leave — give up your own membership.
router.post('/:slug/leave', requireWorkspace(), async (req, res) => {
  const { workspace, membership } = scope(req);
  if (membership.role === 'owner') {
    // Letting the owner walk out would strand the workspace with no one able to
    // administer it. Deleting is the explicit, confirmed exit.
    throw new ForbiddenError(
      'Workspace owners cannot leave. Delete the workspace instead.',
    );
  }
  await removeMember(workspace.id, actor(req).id);
  res.status(204).end();
});

// PATCH /workspaces/:slug/members/:userId — owner-only role change.
router.patch(
  '/:slug/members/:userId',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace, membership } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const input = parseBody(memberRoleUpdateSchema, req.body);
    const targetId = routeParam(req, 'userId');

    if (targetId === actor(req).id) {
      throw new ForbiddenError('You cannot change your own workspace role.');
    }

    const members = await listMembers(workspace.id);
    const target = members.find((member) => member.userId === targetId);
    if (!target) throw new NotFoundError('Workspace member not found.');

    if (!canUpdateMemberRole(membership.role, target.role)) {
      throw new ForbiddenError('You cannot change this member’s role.');
    }
    // Saving an unchanged role is a no-op rather than a spurious write.
    if (target.role !== input.role) {
      const updated = await updateMemberRole(
        workspace.id,
        targetId,
        input.role,
      );
      if (!updated) throw new NotFoundError('Workspace member not found.');
    }

    res.json({ member: { ...target, role: input.role } });
  },
);

// DELETE /workspaces/:slug/members/:userId — remove someone else.
router.delete(
  '/:slug/members/:userId',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace, membership } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const targetId = routeParam(req, 'userId');

    if (targetId === actor(req).id) {
      throw new BadRequestError(
        'Use leave to remove your own membership.',
      );
    }

    const members = await listMembers(workspace.id);
    const target = members.find((member) => member.userId === targetId);
    if (!target) throw new NotFoundError('Workspace member not found.');

    if (!canRemoveMember(membership.role, target.role)) {
      throw new ForbiddenError('You cannot remove this workspace member.');
    }

    await removeMember(workspace.id, targetId);
    res.status(204).end();
  },
);

// --- Invites ----------------------------------------------------------------

// GET /workspaces/:slug/invites — admin+; requesters have no business seeing codes.
router.get('/:slug/invites', requireWorkspace('admin'), async (req, res) => {
  const invites = await listInvites(scope(req).workspace.id);
  res.json({ invites });
});

// POST /workspaces/:slug/invites — mint an invite code.
router.post(
  '/:slug/invites',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace, membership } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const input = parseBody(inviteCreateSchema, req.body);

    if (!canCreateInvite(membership.role, input.role)) {
      throw new ForbiddenError('Only an owner can invite an admin.');
    }

    const invite = await createInvite({
      workspaceId: workspace.id,
      createdBy: actor(req).id,
      role: input.role,
      isReusable: input.isReusable,
      expiresInDays: input.expiresInDays,
    });
    res.status(201).json({ invite });
  },
);

// POST /workspaces/:slug/invites/:inviteId/revoke — kill a code without losing the
// audit trail (deleting drops the record entirely).
router.post(
  '/:slug/invites/:inviteId/revoke',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace, membership } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const invite = await getInviteById(workspace.id, routeParam(req, 'inviteId'));
    if (!invite) throw new NotFoundError('Invite not found.');
    if (!canManageInvite(membership.role, actor(req).id, invite)) {
      throw new ForbiddenError('You cannot manage this invite.');
    }
    if (!(await revokeInvite(workspace.id, invite.id))) {
      throw new ConflictError('That invite is already revoked.');
    }
    res.json({ invite: { ...invite, revokedAt: new Date().toISOString() } });
  },
);

// DELETE /workspaces/:slug/invites/:inviteId — remove a code entirely.
router.delete(
  '/:slug/invites/:inviteId',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace, membership } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const invite = await getInviteById(workspace.id, routeParam(req, 'inviteId'));
    if (!invite) throw new NotFoundError('Invite not found.');
    if (!canManageInvite(membership.role, actor(req).id, invite)) {
      throw new ForbiddenError('You cannot manage this invite.');
    }
    await deleteInvite(workspace.id, invite.id);
    res.status(204).end();
  },
);

// --- Departments ------------------------------------------------------------

// GET /workspaces/:slug/departments — any member; requesters need these to file.
router.get('/:slug/departments', requireWorkspace(), async (req, res) => {
  const departments = await listDepartments(scope(req).workspace.id);
  res.json({ departments });
});

// POST /workspaces/:slug/departments — add a routing target.
router.post(
  '/:slug/departments',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const input = parseBody(departmentCreateSchema, req.body);
    const department = await createDepartment(workspace.id, {
      id: input.id,
      name: assertCleanName(input.name, {
        label: 'Department name',
        maxLength: 80,
      }),
      description: input.description,
    });
    res.status(201).json({ department });
  },
);

// PATCH /workspaces/:slug/departments/:id — rename or re-describe.
router.patch(
  '/:slug/departments/:id',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const input = parseBody(departmentUpdateSchema, req.body);
    const department = await updateDepartment(workspace.id, routeParam(req, 'id'), {
        name:
          input.name === undefined
            ? undefined
            : assertCleanName(input.name, {
                label: 'Department name',
                maxLength: 80,
              }),
        description: input.description,
      },
    );
    if (!department) throw new NotFoundError('Department not found.');
    res.json({ department });
  },
);

// DELETE /workspaces/:slug/departments/:id — custom departments only.
router.delete(
  '/:slug/departments/:id',
  requireWorkspace('admin'),
  adminLimiter,
  async (req, res) => {
    const { workspace } = scope(req);
    assertWorkspaceMutable(workspace.id);
    const id = routeParam(req, 'id');
    if (isDefaultDepartment(id)) {
      // Triage must always have somewhere to route to, so the built-ins stay.
      throw new ForbiddenError('Default departments cannot be removed.');
    }
    if (!(await deleteDepartment(workspace.id, id))) {
      throw new NotFoundError('Department not found.');
    }
    res.status(204).end();
  },
);

export default router;
