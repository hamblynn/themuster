# Backlog

Tracked gaps and feature candidates for The Muster. Not prioritized/dated —
just a working list. Add new items under the relevant section; strike
through or remove once shipped (check the commit that closes it).

## Auth & security

- ~~**Rate limiting on login**~~ — done. `express-rate-limit` applied to
  farmer/hunter login (10/15min), admin login (5/15min, stricter given
  higher blast radius), and both register routes (10/15min, anti-spam).
  Throttle only, no persistent lockout — resets automatically. Needed
  `app.set("trust proxy", 1)` since Render sits in front as a proxy.
- ~~**Forgot-password flow**~~ — done. Token-based reset, farmer/hunter
  only (admin skipped, single fixed demo account). New
  `password_reset_tokens` table (hashed token, 45min expiry,
  single-use). "Forgot password?" link on the login screen; reset link
  opens `/?resetToken=...&role=...`, which `LoginScreen` picks up via
  new URL-param handling in `App.jsx` and immediately clears from the
  visible URL. Verified end-to-end locally (request → token → reset →
  login with new password → old token rejected on reuse). **Still
  inherits the email test-stub below** — reset links go out via the
  same `sendEmail()` that redirects everything to
  `TEST_SITE_EMAIL_OVERRIDE`, so today a reset link for any account
  lands in your inbox, not the actual user's, until that's fixed.
- **Real `JWT_SECRET` in production** — currently falls back to a
  hardcoded dev value in `auth.js`. Needs a real secret from env before
  any non-mockup deployment.

## Notifications

- **Replace the email test-stub** — `sendEmail()` in `server.js`
  currently redirects *all* outgoing mail to `TEST_SITE_EMAIL_OVERRIDE`
  regardless of the actual recipient. Needs real per-user delivery
  (Resend is already wired up, just needs the override removed) before
  emails can go to real farmers/hunters.

## Features

- **Farmer-initiated exclusivity invites** — exclusivity access is
  currently hunter-request → farmer-approve only
  (`exclusivity_requests` table/routes). No reverse flow exists for a
  farmer to proactively invite a specific hunter into exclusivity.
- **Pricing module for hunters** — a way for hunters to pay to use the
  app (e.g. a subscription, a per-booking fee, or a listing/access fee),
  including a payments provider integration (Stripe or similar),
  pricing tiers/plans, and admin visibility into who's paid. Needs
  scoping: subscription vs. per-booking, what farmers see/pay (if
  anything), trial period, and how it interacts with the existing
  `is_active` hunter-verification gate.

## Testing

- **No test suite exists** in either package (confirmed — no test
  runner configured in `package.json` for frontend or backend). Worth
  adding at least basic coverage for `server.js` routes (auth, bookings,
  tracking) before the app grows further.
