# VRKS Control Plane (Next.js + TypeScript + Tailwind)

Modern authenticated control plane for VRKS.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS 4
- Auth.js (`next-auth` v5 beta, Credentials flow)
- Prisma + SQLite (users, roles, audit logs)

## Auth model

- Roles: `ADMIN`, `OPERATOR`, `VIEWER`
- Bootstrap flow: first launch allows creating first admin account on `/login`
- Session-based protected routes via `src/proxy.ts`
- Rate limiting for repeated failed credential attempts
- Password hashing: `bcryptjs`

## API surface (control plane)

Authenticated endpoints:

- `GET /api/control/status`
- `GET /api/control/resources?q=&sort=&policy=&page=&pageSize=`
- `POST /api/control/resources`
- `DELETE /api/control/resources?name=<resource>&runApply=true&runVerify=false&verifyTimeout=8`
- `GET /api/control/resources/export`
- `POST /api/control/resources/import`
- `POST /api/control/resources/validate`
- `POST /api/control/apply`
- `POST /api/control/verify`
- `GET /api/control/presets`
- `POST /api/control/presets`
- `GET /api/repl/sessions`
- `POST /api/repl/sessions`
- `GET /api/repl/sessions/:id`
- `DELETE /api/repl/sessions/:id`
- `POST /api/repl/sessions/:id/input`
- `POST /api/repl/sessions/:id/resize`
- `GET /api/repl/sessions/:id/stream` (SSE)

Auth/admin endpoints:

- `GET /api/auth/bootstrap`
- `POST /api/auth/register`
- `GET /api/auth/users` (ADMIN)

### Profile management features

- Server-side filtering/search/sort/pagination for resource list.
- Strong profile validation and normalization (domains, country codes, policy conflicts).
- Save/remove with optional `runApply` and optional post-check `runVerify`.
- JSON export with SHA-256 fingerprint.
- Bulk import in `merge` or `replace_all` mode.
- Dry-run style validation endpoint for JSON payload before import.

## UI routes

- `/overview` — runtime health + apply/verify operations
- `/profiles` — resource profile inventory, filtering, edit/remove
- `/presets` — preset catalog and apply workflow
- `/imports` — import/export/validate JSON payloads
- `/repl` — full PTY terminal (`xterm` frontend + `node-pty` backend)
- `/users` — user management (ADMIN only)

## Environment

Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

Key variables:

- `DATABASE_URL`
- `AUTH_SECRET`
- `VRKS_PROJECT_ROOT`
- `VRKS_CLI_PATH`
- `VRKS_PYTHON_BIN`
- `VRKS_REQUIRE_SUDO`

If VRKS CLI requires root, set `VRKS_REQUIRE_SUDO=true` and configure sudo policy for non-interactive command execution.

## Run

```bash
npm install
npm run prisma:generate
npm run prisma:push
```

Create or reset admin:

```bash
ADMIN_EMAIL=admin@vrks.local ADMIN_PASSWORD='ChangeMe_12345' ADMIN_NAME='VRKS Admin' npm run seed:admin
```

Start control plane:

```bash
npm run dev
```

Then open `http://127.0.0.1:3000/login`.

## Quality checks

```bash
npm run lint
npm run build
```
