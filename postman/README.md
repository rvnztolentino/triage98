# Postman collection

Importable collection for testing the Triage98 API.

- `triage98.postman_collection.json` — all endpoints + tests
- `triage98.postman_environment.json` — sets `baseUrl` to `http://localhost:4000`

## Import

1. Postman → **Import** → drop both files in.
2. Top-right environment selector → choose **Triage98 (local)**.
3. Start the API: `npm run dev:server` (from the repo root).

## Run

Open the **Collection Runner**, pick "Triage98 API", and run everything top to bottom.
The requests are ordered as a story and clean up after themselves, so the collection can
be re-run as often as you like:

1. **Auth** — an owner registers; the JWT lands in the `token` collection variable.
2. **Workspaces** — that owner creates a workspace, manages its departments, and mints
   an invite. A second user registers (`memberToken`), joins with the code, gets
   promoted, and leaves. The owner then deletes the workspace.

To run individual requests instead, run **Auth / Register** first — everything else
inherits the token it stores.

Headless, from the repo root:

```bash
npx newman run postman/triage98.postman_collection.json \
  -e postman/triage98.postman_environment.json
```

Expected: **36 requests, 72 assertions, 0 failures.**

## What's covered

| Request | Expected |
| --- | --- |
| Meta / Root | 200, `name: triage98` |
| Meta / Health | 200 `ok` (or 503 `degraded` if a dependency is down) |
| Auth / Register | 201, `{ token, user }` |
| Auth / Login | 200, fresh token |
| Auth / Me | 200, current user |
| Auth / Login (wrong password) | 401, generic message |
| Auth / Me (no token) | 401 |
| Auth / Register (validation) | 400, field errors |
| Workspaces / Create workspace | 201, owner role, derived slug |
| Workspaces / List my workspaces | 200, includes the new workspace |
| Workspaces / Get workspace | 200, workspace + caller role |
| Workspaces / List departments | 200, 6 seeded defaults |
| Workspaces / Create · Update · Delete department | 201 · 200 · 204 |
| Workspaces / Update department (empty body) | 400, explains what's missing |
| Workspaces / Delete default department | 403, defaults are permanent |
| Workspaces / Create invite | 201, `XXXX-XXXX-XXXX` code |
| Workspaces / List invites | 200, admin+ only |
| Workspaces / Register second user | 201, stores `memberToken` |
| Workspaces / Join workspace with invite | 201, joins at the invite's role |
| Workspaces / Join again (already a member) | 200, `alreadyMember: true` |
| Workspaces / List members | 200, both members with correct roles |
| Workspaces / Promote member to admin | 200 (owner-only action) |
| Workspaces / Member promotes themselves | 403 |
| Workspaces / Member leaves workspace | 204 |
| Workspaces / Former member reads workspace | 404 (existence not leaked) |
| Workspaces / Owner leaves | 403, delete the workspace instead |
| Workspaces / Revoke invite | 200, `revokedAt` set |
| Workspaces / Join with revoked code | 404, same message as an unknown code |
| Workspaces / Join with malformed code | 400 |
| Workspaces / Create workspace (no token) | 401 |
| Workspaces / Unknown workspace | 404 |
| Workspaces / Demo workspace is read-only | 403 (404 if you haven't joined it) |
| Workspaces / Delete workspace (wrong confirmation) | 400, names the required slug |
| Workspaces / Delete workspace | 204 |

## Notes

- Auth is sent as `Authorization: Bearer {{token}}` at the collection level. Requests
  acting as the second user override this to `{{memberToken}}`; anonymous ones override
  to **No Auth**.
- Rate limits: register 5/hour/IP, login 10/min/IP, workspace create 5/hour/user, invite
  redemption 10 per 10 min/user, admin mutations 60/min per user per workspace. A 429
  with `Retry-After` is expected behavior, not a bug. Clear the counters with
  `docker exec triage98-redis redis-cli flushall`.
- To try the read-only demo workspace, redeem the seeded code `DEMO-CLINIC-2026` via
  **Workspaces / Join workspace with invite** (swap `{{inviteCode}}` for it). Reads
  succeed; every mutation returns 403 whatever your role.
