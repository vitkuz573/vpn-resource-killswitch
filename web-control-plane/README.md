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
- `GET /api/control/resources`
- `POST /api/control/resources`
- `DELETE /api/control/resources?name=<resource>`
- `POST /api/control/apply`
- `POST /api/control/verify`
- `GET /api/control/presets`
- `POST /api/control/presets`

Auth/admin endpoints:

- `GET /api/auth/bootstrap`
- `POST /api/auth/register`
- `GET /api/auth/users` (ADMIN)

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
