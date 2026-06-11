# Devaicon Server

Express + Mongoose backend that mirrors the existing Next.js fake backend
(previously backed by Google Sheets).

## Setup

```bash
cd server
npm install
cp .env.example .env       # then edit values
```

Required env vars (see `.env.example`):

- `MONGODB_URI` — e.g. `mongodb://127.0.0.1:27017/devaicon`
- `SESSION_SECRET` — random string, **at least 32 chars**
- `CLIENT_ORIGIN` — comma-separated origins of the Next.js client (e.g. `http://localhost:3000`)
- `PORT` — defaults to `4000`

## Seeding users

Users live in MongoDB with bcrypt-hashed passwords. To bootstrap accounts from
env vars (mirrors the old `{NAME}_PASSWORD` convention):

```bash
# in .env:
# DEV1_PASSWORD=devpass
# ADMIN1_PASSWORD=adminpass

npm run seed
```

Any username starting with `admin` becomes an admin; everyone else is `dev`.
Re-running the seed updates the password/role for existing users.

## Run

```bash
npm run dev     # node --watch
npm start       # plain node
```

## API

All endpoints under `/api`. Auth uses an httpOnly JWT cookie (`devaicon_session`),
12 h TTL. State-changing requests must come from an allowed origin
(`CLIENT_ORIGIN`).

### Auth
- `POST /api/auth/login` — `{ username, password }` → `{ user }`, sets cookie. Rate-limited (5 / 15 min / IP).
- `POST /api/auth/logout` — clears cookie.
- `GET  /api/auth/me` — `{ user }` or `401`.

### Projects
- `GET    /api/projects` — list (any authed user).
- `POST   /api/projects` — `{ name }` → `{ project }` (admin only).
- `DELETE /api/projects?id=...` — admin only.

### Logs
- `GET    /api/logs` — current user's logs (paginated).
- `GET    /api/logs?all=1` — all logs (admin only). Add `username=` to narrow to one user.
- `POST   /api/logs` — `{ date (YYYY-MM-DD), project, category, hours, description }` → `{ log }`.
  - `hours` must be `> 0` and `<= 3`.
  - `description` must be at least 10 characters (max 1000).
- `DELETE /api/logs?id=...` — devs can delete their own un-approved logs; admins can delete anything.
- `POST   /api/logs/bulk-delete` — `{ ids: string[] }` → `{ deleted }`. Multi-select delete.
  Devs only remove their own un-approved logs; admins remove anything. Skips IDs they can't touch.

#### Listing filters & pagination (`GET /api/logs`)

All optional; combine freely. Malformed values are ignored.

| Param                 | Meaning                                              |
| --------------------- | ---------------------------------------------------- |
| `page`                | 1-based page number (default `1`)                    |
| `pageSize`            | items per page (default `12`, max `100`)             |
| `dateFrom` / `dateTo` | inclusive `YYYY-MM-DD` range on the log's `date`     |
| `hoursMin` / `hoursMax` | inclusive numeric bounds on `hours` (≥ / ≤)        |
| `status`              | `approved` \| `pending` \| `flagged` \| `unflagged`  |
| `project`             | exact project name                                   |
| `category`            | exact category                                       |
| `username`            | only with `all=1` (admin) — scope to one user        |

Response shape:

```json
{
  "logs": [ /* … */ ],
  "pagination": { "page": 1, "pageSize": 12, "total": 137, "totalPages": 12 }
}
```

> The legacy Sheets backend (`/api/legacy/logs`) accepts the same params and returns
> the same shape, except `status=flagged`/`unflagged` match nothing there (no flag data),
> and bulk delete is `DELETE /api/legacy/logs?ids=a,b,c`.

Each log in the response includes `flagged`, `flaggedAt`, `flaggedBy`, and
`flagReason` alongside the existing approval fields.

### Admin
- `POST /api/admin/approve` — `{ ids: string[], approved?: boolean }` → `{ updated }`. Default `approved: true`.
- `POST /api/admin/flag` — `{ ids: string[], flagged?: boolean, reason?: string }` → `{ updated }`.
  - Default `flagged: true`. `reason` is optional (max 500 chars). Unflagging clears the reason.
  - Flag state is independent of approval — a log can be both flagged and approved.
- `GET  /api/admin/export` — CSV of all TimeLogs + Projects (includes flag columns).

## Dual-backend setup

Both backends are live at the same time:

| Path                  | Backed by         | Notes                                  |
| --------------------- | ----------------- | -------------------------------------- |
| `/api/auth/*`         | **Express + Mongo** | Proxied via Next.js rewrites           |
| `/api/logs`           | **Express + Mongo** | Proxied via Next.js rewrites           |
| `/api/projects`       | **Express + Mongo** | Proxied via Next.js rewrites           |
| `/api/admin/*`        | **Express + Mongo** | Proxied via Next.js rewrites           |
| `/api/legacy/auth/*`  | Google Sheets     | Original Next.js route handlers        |
| `/api/legacy/logs`    | Google Sheets     | Original Next.js route handlers        |
| `/api/legacy/projects`| Google Sheets     | Original Next.js route handlers        |
| `/api/legacy/admin/*` | Google Sheets     | Original Next.js route handlers        |

How it works:
- `client/next.config.mjs` rewrites `/api/{auth,logs,projects,admin}/*` to
  `${EXPRESS_API_URL}/api/...`. From the browser's perspective, calls stay
  same-origin so cookies and CSRF protections keep working.
- The Sheets-backed routes were moved to `client/src/app/api/legacy/*` and
  remain reachable at `/api/legacy/...` for fallback / comparison.
- Both backends use the **same `SESSION_SECRET`** to sign the
  `devaicon_session` JWT, so a login from either side gives you a session
  that the other side also accepts.

### Client env

In `client/.env` (or `.env.local`):

```
EXPRESS_API_URL=http://localhost:4000
SESSION_SECRET=<the same secret as server/.env>
```

`EXPRESS_API_URL` is only used by `next.config.mjs` at build/start time; if
unset it falls back to `http://localhost:4000`.

## Notes

- The route shapes match the original Next.js routes — the frontend doesn't
  need any code changes to switch backends.
- IDs are Mongo `_id` strings (24-hex), not UUIDs.
- `approvedAt` is a Date in Mongo but is serialized as ISO string (or `""`) in
  responses, matching the old shape.
