# Devaicon Server

Express + Mongoose backend for the time logger and the admin panel. It owns
all data and every permission check; the Next.js client is UI only.

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

## Roles and permissions

Access is role-based. Each user has one role; each role is a set of
permissions from the fixed catalogue in `src/permissions.js`. Roles and their
toggles are managed in the admin panel (`/admin/roles`).

A role is a starting profile: an admin can also grant or remove individual
permissions for one person (Dashboard → Team → Edit access). Those are
stored as overrides, so editing a role still reaches everyone holding it except
where a person has their own setting for that permission. Effective
permissions = role + granted − revoked (`effectivePermissions()` in
`src/models/Role.js`). Owners always hold everything.

On every start, `ensureRbac()` (`src/lib/rbac.js`):

- creates the locked **Owner** role (always every permission) and the default
  **Admin** and **Developer** roles, if missing;
- migrates users still on the old `role: 'dev' | 'admin'` field — `admin`
  becomes Owner, `dev` becomes Developer. Safe to run repeatedly.

The session cookie holds only the user id and a `sessionVersion`. User, role
and permissions are read from Mongo on every request, so role changes,
deactivation and password resets take effect immediately.

## Seeding users

Normally people are added from the admin panel (`/admin/team`). To bootstrap
the first Owner on an empty database, use env vars:

```bash
# in .env:
# ADMIN1_PASSWORD=adminpass   → Owner
# DEV1_PASSWORD=devpass       → Developer

npm run seed
```

Any username starting with `admin` becomes an Owner; everyone else a
Developer. Re-running the seed resets the password and role for existing
users, and signs them out.

## Run

```bash
npm run dev     # node --watch
npm start       # plain node
```

## API

All endpoints under `/api`. Auth uses an httpOnly JWT cookie (`devaicon_session`),
12 h TTL. State-changing requests must come from an allowed origin
(`CLIENT_ORIGIN`).

Each endpoint names the permission it needs. `401` means not signed in (or
the session was revoked — the cookie is cleared); `403` means the role lacks
the permission.

### Auth
- `POST /api/auth/login` — `{ username, password }` → `{ user }`, sets cookie. Rate-limited (20 failures / 15 min / IP).
  `403 account_disabled` for deactivated users.
- `POST /api/auth/logout` — clears cookie.
- `GET  /api/auth/me` — `{ user }` or `401`, where
  `user = { id, username, role: { id, name, isOwner }, permissions: string[] }`.

### Projects
- `GET    /api/projects` — list (any signed-in user).
- `POST   /api/projects` — `{ name }` → `{ project }` (`projects.manage`).
- `DELETE /api/projects?id=...` — `projects.manage`.

### Logs
- `GET    /api/logs` — current user's logs (`timelogs.log`). Returns all matching logs unless
  pagination is requested (see below).
- `GET    /api/logs?all=1` — all logs (`timelogs.review`). Add `username=` to narrow to one user.
- `POST   /api/logs` — `{ date (YYYY-MM-DD), project, category, hours, description }` → `{ log }` (`timelogs.log`).
  - `hours` must be `> 0` and `<= 3`.
  - `description` must be at least 10 characters (max 1000).
- `DELETE /api/logs?id=...` — your own un-approved logs; anything with `timelogs.delete_any`.
- `POST   /api/logs/bulk-delete` — `{ ids: string[] }` → `{ deleted }`. Multi-select delete.
  Same rule as single delete. Skips IDs the caller can't touch.

#### Listing filters & pagination (`GET /api/logs`)

All optional; combine freely. Malformed values are ignored. Pagination is
**opt-in**: if neither `page` nor `pageSize` is sent, every matching log is
returned (so dashboards can compute accurate totals).

| Param                 | Meaning                                              |
| --------------------- | ---------------------------------------------------- |
| `page`                | 1-based page number (default `1`); engages paging    |
| `pageSize`            | items per page (default `12`, max `100`); engages paging |
| `dateFrom` / `dateTo` | inclusive `YYYY-MM-DD` range on the log's `date`     |
| `hoursMin` / `hoursMax` | inclusive numeric bounds on `hours` (≥ / ≤)        |
| `status`              | `approved` \| `pending` \| `flagged` \| `unflagged`  |
| `project`             | exact project name                                   |
| `category`            | exact category                                       |
| `username`            | only with `all=1` (reviewer) — scope to one user     |

Response shape:

```json
{
  "logs": [ /* … */ ],
  "pagination": { "page": 1, "pageSize": 12, "total": 137, "totalPages": 12 }
}
```

Each log in the response includes `flagged`, `flaggedAt`, `flaggedBy`, and
`flagReason` alongside the existing approval fields.

### Admin (time-log review)
- `POST /api/admin/approve` (`timelogs.review`) — `{ ids: string[], approved?: boolean }` → `{ updated }`. Default `approved: true`.
- `POST /api/admin/flag` (`timelogs.review`) — `{ ids: string[], flagged?: boolean, reason?: string }` → `{ updated }`.
  - Default `flagged: true`. `reason` is optional (max 500 chars). Unflagging clears the reason.
  - Flag state is independent of approval — a log can be both flagged and approved.
- `GET  /api/admin/export` (`timelogs.export`) — CSV of all TimeLogs + Projects (includes flag columns).

### Users (`users.manage`)
- `GET   /api/users` — `{ users: [{ id, username, displayName, role, permissions, overrides, active, lastLoginAt, createdAt }] }`.
  `permissions` is effective; `overrides` is `{ granted, revoked }`.
- `POST  /api/users` — `{ username, password, roleId, displayName? }` → `{ user }`. Password 8–200 chars.
- `PATCH /api/users/:id` — `{ displayName?, roleId?, active? }` → `{ user }`. Deactivating signs the
  user out; changing the role clears their overrides.
- `PUT   /api/users/:id/permissions` — `{ granted, revoked }` → `{ user }`. Replaces the person's
  overrides; entries matching the role anyway are dropped. Not on yourself or an Owner, and a
  non-Owner may only change permissions they hold.
- `POST  /api/users/:id/password` — `{ password }`. Signs the user out everywhere
  (except the caller's own browser, when resetting their own).

Guardrails: nobody changes their own role or deactivates themselves; only an
Owner may assign the Owner role or edit an Owner's account; there is always
at least one active Owner.

### Roles
- `GET    /api/roles` (`users.manage` or `roles.manage`) —
  `{ roles: [{ id, name, description, permissions, isOwner, userCount }], permissions: catalogue }`.
- `POST   /api/roles` (`roles.manage`) — `{ name, description?, permissions? }` → `{ role }`.
- `PATCH  /api/roles/:id` (`roles.manage`) — `{ name?, description?, permissions? }` → `{ role }`.
  Unknown permission keys are dropped.
- `DELETE /api/roles/:id` (`roles.manage`) — `409 role_in_use` while anyone holds it.

The Owner role can't be edited or deleted, and a non-Owner can't edit the
role they hold.

### Profile (any signed-in user, acts on themselves)
- `GET   /api/profile` — `{ user, access: [{ key, group, label, description, held, source: 'role' | 'personal' | 'removed' | null }], lastLoginAt, createdAt }`. `access` covers the whole catalogue; `held` says whether the person has each one.
- `PATCH /api/profile` — `{ displayName }` (≤ 60 chars; empty clears it).
- `POST  /api/profile/password` — `{ currentPassword, newPassword }`. Wrong current passwords are
  rate-limited per account. Signs out other devices; this browser gets a fresh cookie.
- `POST  /api/profile/sign-out-others` — same effect without a password change.

### Insights (blog)

Admin — any of `posts.write`, `posts.publish`, `posts.delete` to read:
- `GET    /api/posts` (`?status=draft|scheduled|published&q=`) — summaries.
- `GET    /api/posts/:id` — the editor's copy; `GET /api/posts/:id/preview` — the reader's view, drafts included.
- `POST   /api/posts` (`posts.write`) — `{ title }` → a new draft with a unique slug. May also carry any
  field `PATCH` accepts (except `featured`), checked the same way; the dashboard's post import uses this so
  a file is refused whole rather than half-saved. A `slug` given here is made unique instead of refused.
- `PATCH  /api/posts/:id` (`posts.write`, plus `posts.publish` if the post is live or scheduled) —
  any of `title, subtitle, slug, categoryId, tags, authorId, heroImage, body, faqs, closingCtaId, toc, seo, featured`.
  A slug change on a post that has ever been public keeps the old slug as a 301 redirect. At most 3 posts featured.
- `POST   /api/posts/:id/publish` (`posts.publish`) — `{ publishAt? }`; a future date schedules. Refused with
  `problems[]` until the post has a title, valid slug, author, body and (if it has a hero image) alt text.
- `POST   /api/posts/:id/unpublish` (`posts.publish`), `DELETE /api/posts/:id` (`posts.delete`).

Library — readable by anyone working on posts, writable with `blog.library`; each item carries `postCount`,
and anything still used by a post can't be deleted:
`/api/authors`, `/api/ctas`, `/api/categories` (`GET`, `POST`, `PATCH /:id`, `DELETE /:id`).

Public, no session, live posts only (the Next.js site reads these server-side and caches them):
- `GET /api/public/posts` (`?featured=1&category=<slug>&limit=`), `GET /api/public/posts/:slug`
  (`{ post, related }`, or `{ redirect }` for an old slug), `GET /api/public/categories`.

Post bodies are editor documents (Tiptap JSON). They're stored as-is and rendered by the site through a
whitelist of node types with URL checks, never as HTML.

On first start the four posts that used to be hard-coded in the client are imported from
`src/seed/insights.json` (keeping their URLs and original dates), once. A timer publishes scheduled posts
every minute. After any change that affects live content, the server asks the site to refresh the affected
pages (`SITE_URL` + `REVALIDATE_SECRET`); without those set, pages refresh on their 5-minute cache timer.

## Running with the client

`client/next.config.mjs` rewrites `/api/{auth,logs,projects,admin,preferences,users,roles,profile,posts,authors,ctas,categories}/*`
to `${EXPRESS_API_URL}/api/...`, so calls stay same-origin and cookies keep
working. The Next proxy checks the session cookie's signature to send
signed-out visitors to `/login`, which is why both apps need the **same
`SESSION_SECRET`**.

### Client env

In `client/.env` (or `.env.local`):

```
EXPRESS_API_URL=http://localhost:4000
SESSION_SECRET=<the same secret as server/.env>
# Optional, for instant page refresh on publish — the same value as server/.env:
REVALIDATE_SECRET=<a long random string>
# Optional, for image uploads in the editor (from the Vercel Blob store):
BLOB_READ_WRITE_TOKEN=<token>
```

Without `BLOB_READ_WRITE_TOKEN` the editor still works; images are added by pasting a link.

`EXPRESS_API_URL` is only used by `next.config.mjs` at build/start time; if
unset it falls back to `http://localhost:4000`.

## Notes

- IDs are Mongo `_id` strings (24-hex), not UUIDs.
- `approvedAt` is a Date in Mongo but is serialized as ISO string (or `""`) in
  responses, matching the old shape.
