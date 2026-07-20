# Triage98

> Local-first operations triage. The AI suggests, a human decides. No cloud accounts,
> no API keys, no vendor signup to run it.

Triage98 is an operations triage system for schools, clinics, offices, and facilities
teams. People submit messy internal requests in plain language; a **local** AI model
suggests a category, priority, and department; an admin reviews the suggestion and
approves or overrides it; approved requests become tracked tickets inside
workspace-scoped queues.

Everything runs on your own machine — database, cache, file storage, and the AI model.
It never phones home.

> **Status:** early build. This branch (`chore/scaffold`) establishes the project
> skeleton: Docker-based Postgres + Redis, the database schema, a booting API with a
> health endpoint, and a retro React shell. Auth, requests, triage, review, and tickets
> land in subsequent branches.

## Stack

- **Frontend:** React + Vite (TypeScript), React Router, Axios, [98.css](https://jdan.github.io/98.css/)
- **Backend:** Node.js + Express (TypeScript, ESM), raw SQL via `pg` — no ORM
- **Database:** PostgreSQL · **Cache/queue:** Redis (ioredis)
- **Containers:** Docker Compose (Postgres + Redis)
- **AI:** local model runtime (Ollama or compatible), over HTTP on localhost

## Prerequisites

- [Docker](https://www.docker.com/) (OrbStack or Docker Desktop)
- Node.js LTS (v20+)
- *(Later branches)* a local model runtime such as [Ollama](https://ollama.com/) with an
  instruct-tuned model pulled

## Quickstart

```bash
# 1. Configure (defaults work out of the box)
cp .env.example .env

# 2. Start Postgres + Redis (schema auto-applies on first boot)
docker compose up -d

# 3. Install workspace dependencies
npm install

# 4. Run the API and client dev servers in two separate terminals
npm run dev:server   # terminal 1 — Express API on :4000
npm run dev:client   # terminal 2 — Vite SPA on :5173
```

- API: http://localhost:4000 (health at http://localhost:4000/health)
- Client: http://localhost:5173

The home screen shows a live system-status panel reflecting the API's health check.

## Project layout

```
server/        Express API (and, later, the background triage worker)
client/        React + Vite SPA
db/init/       SQL schema + seed, applied automatically on first Postgres boot
docker-compose.yml
```

## Common scripts

| Command              | What it does                                  |
| -------------------- | --------------------------------------------- |
| `npm run dev:server` | Express API dev server (`:4000`)               |
| `npm run dev:client` | Vite SPA dev server (`:5173`)                  |
| `npm run build`      | Type-check-safe build of both workspaces      |
| `npm run typecheck`  | TypeScript, no emit, across workspaces         |
| `npm run lint`       | ESLint across workspaces                       |
| `npm test`           | Vitest across workspaces                        |
| `npm run db:up`      | Start Postgres + Redis                         |
| `npm run db:down`    | Stop them (data kept)                          |
| `npm run db:reset`   | Stop and wipe data (re-applies `db/init`)      |

## Local-first, by design

No hosted AI, no managed database, no third-party auth. Clone it, bring up two
containers, point it at a local model, and it runs entirely on one box. This is the
whole point — plenty of teams that need triage can't send internal requests to a cloud
provider.

## License

[MIT](./LICENSE)
