// Domain identity types shared across the auth layer. Roles mirror the schema's
// check constraint on users.role / workspace_members.role.

export type UserRole = 'requester' | 'admin' | 'owner';

/** The user shape safe to return to clients — never includes the password hash. */
export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}
