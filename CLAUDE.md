# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"The Muster" — a mockup web app connecting Victorian farmers (who have deer on their land) with licensed hunters. It has two independently-run pieces:

- **Frontend** (repo root): a Vite + React 19 SPA. Almost the entire UI lives in one file, [src/App.jsx](src/App.jsx) (~3500 lines).
- **Backend** ([server/](server/)): a separate Node/Express + SQLite API with its own `package.json`/lockfile. Not started by the frontend automatically — must be run side by side.

## Commands

Frontend (run from repo root):
```
npm run dev       # start Vite dev server
npm run build     # production build
npm run lint      # oxlint
npm run preview   # preview a production build
```

Backend (run from `server/`, separate `npm install` required — it's not a workspace):
```
npm install        # first time only
npm run seed        # (re)build muster.db from schema.sql, wiping existing data
npm start           # start the API on http://localhost:4000
```
The frontend expects the backend at `http://localhost:4000/api` (hardcoded as `API_BASE` in `App.jsx`) and will show fetch errors in the UI if it isn't running. There is no test suite in either package.

Demo logins after seeding (password `password123` for all):
- Farmer — `nathan@example.com`
- Hunters — `tom@example.com`, `jess@example.com`, `dale@example.com`
- Admin — username `admin`, password printed by `npm run seed` (see [server/seed.js](server/seed.js))

## Architecture

### Frontend (`src/App.jsx`)
Everything — design tokens, shared UI primitives, and every screen — is defined in this one file, roughly in this order:
- Design tokens (`C` color map, `fontDisplay`/`fontBody`/`fontMono`) and small shared components (`Pill`, `Avatar`, `PrimaryButton`, `EarTag`, `StarRow`/`StarRatingInput`, etc.) — all styled with inline `style` objects, not a CSS framework.
- `apiFetch(path, { body, ... })` — the one place every request goes through: always sends `credentials: "include"` (required for the session cookie, see below) and JSON-encodes `body` if it's a plain object. Use it instead of raw `fetch` for anything hitting the API.
- `AuthContext` / `useAuth()` — holds just `{ user }` (plus `login`/`logout`/`updateProperty`/`updateSelf`). There is no client-managed token: the session lives in an httpOnly cookie set by the server, so `App()` at the bottom rehydrates on load by calling `apiFetch("/me")` and seeing whether the cookie (if any) is still valid — a 401 just means logged out, not an error.
- One function component per screen (`FarmerDashboard`, `HunterProfile`, `BookingRequest`, `MessagesThread`, `HunterBookings`, `FarmerBookings`, `HunterCredentials`, `ReferNeighbour`, `EditProperty`, `FarmerSignup`, `HunterSignup`, `AdminPanel`, `LoginScreen`), each fetching its own data directly via `apiFetch`.
- `AppShell` (bottom of the file) is the router: there's no routing library, just a `screen` string in `useState` and a tab bar that flips between the screen components. Tabs are filtered by role (`access: "all" | "guest" | "farmer" | "hunter"` per tab) so a logged-in farmer doesn't see hunter-only screens and vice versa; guests (logged out) see everything, since the tab bar doubles as a way to browse every screen of the mockup. Admin isn't in the tab array at all — it's a separate small link in the header, since admin auth is a second, independent session (see below).

Two things to know before touching auth or the map:
- Admin auth is a **second, independent session** from the farmer/hunter one — logging into `AdminPanel` (username/password, see below) doesn't affect or require the main `AuthContext` session, and vice versa. Both are just httpOnly cookies the browser sends automatically; `apiFetch`'s `credentials: "include"` covers both, the server picks the right one per route.
- `PropertyMap` embeds a real Google Map (the key-less `maps.google.com/maps?...&output=embed` iframe, no API key/billing needed) and separately fetches real cadastral parcel boundaries from Victoria's public VicPlan ArcGIS service (`/api/properties/:id/parcel`) to re-centre the map on the actual parcel when a lot/plan match succeeds — both are intentional, not stubs.

### Backend (`server/`)
- `server.js` — single-file Express app, all REST routes inline (auth, properties, sightings, hunters/credentials, bookings, harvest declarations, reviews, referrals, messages, admin, VicPlan parcel proxy). Uses `better-sqlite3` synchronously, no ORM.
- `auth.js` — bcrypt password hashing + JWT, `requireAuth(role?)` and `requireAdminAuth` Express middleware. Sessions are httpOnly cookies (`muster_token` for farmer/hunter, `muster_admin_token` for admin — separate names so the two sessions don't collide), not a token in the response body — the client never touches it. CORS is locked to `CLIENT_ORIGIN` (defaults to `http://localhost:5173`) with `credentials: true`, both required for the browser to send/accept the cookie cross-origin.
- Admin is a real account (`admins` table, `POST /api/auth/admin/login`), not a shared secret — replaced the old `X-Admin-Key` header gate.
- `PATCH /api/me` lets a logged-in farmer or hunter edit their own account fields (name/email/phone, plus bio/location/capability for hunters) — separate from `PATCH /api/properties/:id`, which is property data, not account data.
- `schema.sql` is the source of truth for the data model: `admins`, `farmers` / `hunters` (separate tables, separate login flows) → `properties`, `credentials`, `bookings`, `messages`, `reviews`, `referrals`, `sightings`, `harvest_declarations`. `reset.sql` drops all tables; `seed.js` runs reset → schema → inserts demo data (including a demo admin account) on every `npm run seed`, so the DB is disposable — the demo admin password is a fixed dev value, printed to the console by the seed script.
- Credential rows (`credential_type`, one per hunter via a UNIQUE constraint, includes an optional `document_url` link to a certificate/permit scan) drive the "ear tag" verification badges in the UI; a hunter stays `is_active = 0` (invisible in farmer matches) until an admin verifies their credentials. `POST /api/hunters/:id/credentials` is both the sign-up flow's bulk insert and the hunter's own later self-service edit (`HunterCredentials` screen) — any edit resets that credential to `pending`.

### Other top-level directories
- `database/muster.sql` is an **older, unused** copy of the schema (predates password hashing) — it's not read by any code path. `server/schema.sql` is the one actually used by `seed.js`.
- `files/` holds a standalone earlier draft of the mockup (`muster-mockup.jsx`, no backend calls) plus export zips — not part of the built app; don't treat it as current.
