-- Baseline seed applied on first boot: a demo workspace, its default departments,
-- and a reusable invite code so a fresh clone has something to join into. Realistic
-- demo *content* (requests, tickets, activity) is seeded separately later.

set client_min_messages to warning;

insert into workspaces (id, name, slug, created_by)
values ('00000000-0000-4000-8000-000000000001', 'Demo Clinic', 'demo-clinic', null);

insert into departments (workspace_id, id, name, description) values
  ('00000000-0000-4000-8000-000000000001', 'it', 'IT', 'Network, devices, software, projectors, printers, accounts.'),
  ('00000000-0000-4000-8000-000000000001', 'facilities', 'Facilities', 'General building operations and space coordination.'),
  ('00000000-0000-4000-8000-000000000001', 'maintenance', 'Maintenance', 'HVAC, leaks, electrical, plumbing, repairs.'),
  ('00000000-0000-4000-8000-000000000001', 'security', 'Security', 'Access control, doors, gates, badges, incidents.'),
  ('00000000-0000-4000-8000-000000000001', 'admin', 'Admin', 'Records, scheduling, office supplies, front desk operations.'),
  ('00000000-0000-4000-8000-000000000001', 'clinic', 'Clinic / Health', 'Patient areas, health concerns, medical rooms, clinical workflow support.');

-- Reusable invite so anyone who clones the repo can join the demo workspace.
insert into workspace_invites (
  id, workspace_id, code, role, created_by, expires_at, used_at, revoked_at, is_reusable
) values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'DEMO-CLINIC-2026',
  'requester',
  null, null, null, null,
  true
);
