-- Triage98 schema. Applied automatically on the first boot of a fresh Postgres
-- volume (docker-entrypoint-initdb.d). This is a clean, greenfield schema — there
-- are no migrations to replay, so tables are defined once with their final shape.
--
-- Design notes carried over from the reference (TriageDesk), the expensive way:
--   * Identity is boring: app-generated UUID primary keys on users; every other
--     table foreign-keys to that. The user id is never tied to an auth provider.
--   * Access control is enforced in APPLICATION code at a single choke point.
--     There is deliberately no row-level security here — every query path goes
--     through workspace-membership and role checks in the API layer.
--   * Every workspace-scoped table carries workspace_id, indexed for the
--     (workspace_id, status, created_at desc) access patterns the queue views use.
--   * Composite (workspace_id, id) foreign keys keep related rows in the same
--     workspace — a ticket cannot reference a request from another workspace.

set client_min_messages to warning;

-- Users own their identity. password_hash is a bcrypt hash; auth is self-hosted.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null default '',
  -- Global default role; effective permissions come from workspace_members.role.
  role text not null default 'requester' check (role in ('requester', 'admin', 'owner')),
  -- Display-name change throttling (max 2 per rolling 3 months). window_start marks
  -- the first change in the active window; the app resets the count once it elapses.
  name_change_count integer not null default 0,
  name_change_window_start timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Role a user holds within a specific workspace. This is the authoritative source
-- for authorization checks (not users.role).
create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'requester' check (role in ('requester', 'admin', 'owner')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  code text not null unique,
  role text not null default 'requester' check (role in ('requester', 'admin')),
  created_by uuid references users(id) on delete cascade,
  expires_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  is_reusable boolean not null default false,
  created_at timestamptz not null default now()
);

-- Departments are per-workspace; id is a short slug ('it', 'facilities', ...).
create table departments (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  description text not null default '',
  primary key (workspace_id, id)
);

-- A request is the raw, plain-language submission before human review.
create table requests (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  requester_user_id uuid references users(id) on delete set null,
  description text not null,
  location text not null default '',
  contact_name text not null default '',
  urgency_note text not null default '',
  status text not null default 'needs-review'
    check (status in ('needs-review', 'approved', 'rejected', 'duplicate')),
  duplicate_of_ticket_id text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- Lets (workspace_id, request_id) composite foreign keys reference this table.
  unique (workspace_id, id)
);

-- The AI suggestion for a request. Persisted with confidence + reasoning so the
-- reviewer can see why. source records which triage path produced it; every
-- failure mode falls back to a 'rules' result rather than erroring.
create table ai_triage_results (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  request_id text not null,
  source text not null check (source in ('rules', 'ollama')),
  title text not null,
  category text not null,
  priority text not null check (priority in ('low', 'medium', 'high', 'critical')),
  department text not null,
  confidence real not null default 0 check (confidence >= 0 and confidence <= 1),
  summary text not null default '',
  priority_reasoning text not null default '',
  similar_ticket_ids text[] not null default '{}',
  raw_response jsonb,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, request_id) references requests(workspace_id, id) on delete cascade,
  foreign key (workspace_id, department) references departments(workspace_id, id)
);

-- An approved request becomes a tracked ticket.
create table tickets (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  request_id text,
  requester_user_id uuid references users(id) on delete set null,
  title text not null,
  description text not null,
  location text not null default '',
  contact_name text not null default '',
  urgency_note text not null default '',
  status text not null default 'new'
    check (status in ('new', 'open', 'in-progress', 'resolved', 'closed')),
  priority text not null check (priority in ('low', 'medium', 'high', 'critical')),
  department text not null,
  category text not null,
  triage_summary text not null default '',
  priority_reasoning text not null default '',
  resolution_notes text not null default '',
  duplicate_of_ticket_id text references tickets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, request_id) references requests(workspace_id, id),
  foreign key (workspace_id, department) references departments(workspace_id, id)
);

-- Append-only history for a request or a ticket.
create table ticket_activity (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ticket_id text,
  request_id text,
  action text not null,
  actor text not null,
  details text not null default '',
  created_at timestamptz not null default now(),
  foreign key (workspace_id, ticket_id) references tickets(workspace_id, id) on delete cascade,
  foreign key (workspace_id, request_id) references requests(workspace_id, id) on delete cascade
);

create table ticket_notes (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ticket_id text not null,
  actor text not null,
  body text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, ticket_id) references tickets(workspace_id, id) on delete cascade
);

-- Arbitrary per-workspace key/value settings.
create table workspace_metadata (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null,
  value text not null,
  primary key (workspace_id, key)
);

-- Uploaded files live on local disk; storage_path is relative to UPLOAD_DIR.
create table request_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  request_id text not null,
  file_name text not null default 'Attachment',
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, request_id) references requests(workspace_id, id) on delete cascade
);

-- Per-recipient in-app notifications. link is a workspace-relative path (e.g.
-- '/tickets/TRG-1042') resolved against the active workspace in the UI.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  actor text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes shaped around the (workspace_id, status, created_at desc) access
-- patterns the queue views use, plus requester-scoped listings.
create index requests_workspace_status_created_at_idx
  on requests (workspace_id, status, created_at desc);
create index requests_requester_created_at_idx
  on requests (requester_user_id, created_at desc);

create index tickets_workspace_status_created_at_idx
  on tickets (workspace_id, status, created_at desc);
create index tickets_requester_created_at_idx
  on tickets (requester_user_id, created_at desc);
-- One approved request maps to at most one ticket. Blocks duplicate tickets from
-- concurrent approvals (TOCTOU on the read-then-insert in the review flow).
create unique index tickets_workspace_request_unique_idx
  on tickets (workspace_id, request_id) where request_id is not null;

create index ai_triage_results_workspace_request_created_at_idx
  on ai_triage_results (workspace_id, request_id, created_at desc);

create index ticket_activity_ticket_created_at_idx
  on ticket_activity (ticket_id, created_at desc);
create index ticket_activity_workspace_created_at_idx
  on ticket_activity (workspace_id, created_at desc);

create index ticket_notes_workspace_ticket_created_at_idx
  on ticket_notes (workspace_id, ticket_id, created_at desc);

create index workspace_members_user_created_at_idx
  on workspace_members (user_id, created_at);
create index workspace_invites_workspace_created_at_idx
  on workspace_invites (workspace_id, created_at desc);
create index departments_workspace_name_idx
  on departments (workspace_id, name);
create index request_attachments_workspace_request_created_at_idx
  on request_attachments (workspace_id, request_id, created_at desc);

create index notifications_user_workspace_created_at_idx
  on notifications (user_id, workspace_id, created_at desc);
create index notifications_user_workspace_unread_idx
  on notifications (user_id, workspace_id) where read_at is null;
