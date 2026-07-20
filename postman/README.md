# Postman collection

Importable collection for testing the Triage98 API.

- `triage98.postman_collection.json` — all endpoints + tests
- `triage98.postman_environment.json` — sets `baseUrl` to `http://localhost:4000`

## Import

1. Postman → **Import** → drop both files in.
2. Top-right environment selector → choose **Triage98 (local)**.
3. Start the API: `npm run dev:server` (from the repo root).

## Run

- **Register** first — it generates a unique email, creates the account, and stores the
  JWT in the `token` collection variable.
- **Login** and **Me** then reuse that token automatically.
- Or open the **Collection Runner**, pick "Triage98 API", and run everything top to
  bottom — every request has test assertions.

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

## Notes

- Auth is sent as `Authorization: Bearer {{token}}` at the collection level; the
  "no token" request overrides this to **No Auth**.
- Register is rate-limited to 5/hour/IP and Login to 10/min/IP. Hitting the limit
  returns 429 with a `Retry-After` header — expected, not a bug.
