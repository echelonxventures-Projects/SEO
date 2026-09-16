# Security Model

Threat coverage, not checkbox security. Every claim is enforced in code and
exercised by `scripts/smoke.ts`.

## 1. Authentication

| Control | Implementation |
|---|---|
| Password storage | bcrypt, cost `OMNI_BCRYPT_ROUNDS` (default 12). Policy ≥10 chars + character classes (zod). |
| Brute force | Per-account lockout (`failedLoginCount` → `lockedUntil`, env-tunable), per-IP token-bucket on auth endpoints (`OMNI_RATE_AUTH_PER_MIN`). |
| Enumeration defence | Forgot-password always 200; login errors do not distinguish unknown vs wrong email; invitation email-only. |
| Sessions | 256-bit random token; **only SHA-256(token) stored**; httpOnly + SameSite=Lax + `Secure` in prod; 14-day expiry; `lastSeenAt` throttled; server-side revoke (`revokedAt`) — logout + password reset kill sessions. |
| Email verification | 6-digit OTP, 15 min TTL, max attempts, single-use (consumed), purpose-bound hash (`sha256(purpose:subject:code)`). |
| Password reset | OTP code emailed via SMTP (logged in dev, never silently dropped); resets revoke all sessions. |
| API keys | `omni_<48 base64url>`; only SHA-256 stored; display prefix only; optional expiry + **explicit scope grants** (subset of creator role). Revocation immediate. Last-used tracked. |

## 2. Request integrity (CSRF / origin)

- Double-submit CSRF token **derived per session** (`hmac(csrfSecret, …)`): stored
  server-side, client cookie readable, write requests must send the
  `x-csrf-token` header matching the session's secret.
- All mutating requests additionally validated against `Origin` == `APP_URL` host.
- Bearer (API key) requests are exempt from CSRF by design (non-ambient
  credential) but still pass the permission layer.

## 2b. Second factor & session lifecycle

- **TOTP 2FA** (RFC 6238, SHA1/HMAC, ±1 step skew, constant-time compare) — secret encrypted at rest (AAD `totp:<userId>`), enabled only after verifying a live code; 8 single-use SHA-256-hashed recovery codes, consumed atomically
- Password change requires the current password and **revokes every session**; failed MFA attempts feed the same lockout counter
- `/auth/sessions` lists live sessions; revoke-others keeps the current one
- Per-endpoint auth buckets (`auth:login:ip`, `auth:register:ip`, …) — credential-stuffing on login can't DoS registrations

## 3. Authorization (RBAC + tenancy)

- 55 permissions × 5 system roles seeded **into the DB** (`Permission`, `Role`,
  `RolePermission`); the catalog in `src/server/catalogs/permissions.ts` is only
  the seed source. Runtime checks read grants from the DB — the matrix is auditable
  data, viewable at `/team` (permission matrix), changeable without redeploy.
- Every non-public route declares `permission: "module.action"`; the `route()`
  wrapper enforces authn → CSRF → rate → permission → service.
- Service layer re-checks: row ownership via `requireOwned` (foreign/missing both
  `NOT_FOUND`), role-rank safety for member ops (can't invite/promote/remove at or
  above your rank; OWNER protected), state-machine legality (invoice void/issue,
  task transitions, quote conversion) server-side only.
- Client-side nav filtering is UX only; security is enforced server-side.

## 4. Tenant isolation

- `orgId` on every tenant row; active org resolved from membership (never from a
  request body); composite uniques/indexes include `orgId` (DB-enforced per-tenant
  uniqueness for names, numbers, keywords, metrics, cycles…).
- Verified by smoke: tenant-2 GETs tenant-1 invoice id → 404.

## 5. Cryptography

| Use | Scheme |
|---|---|
| Gateway & AI provider credentials at rest | AES-256-GCM envelope encryption, versioned keyring (`OMNI_ENCRYPTION_KEYS` JSON, `OMNI_ENCRYPTION_KEY_VERSION`) — rotation = add key N+1, re-encrypt on next save; AAD = `gateway:<scope>:<orgId>:<provider>` binds ciphertext to its owner/purpose (anti swap/replay). |
| Signed tokens (invitations, checkout links) | HMAC-SHA256 over purpose+payload with `OMNI_TOKEN_SECRET`; includes purpose tag, expiry, nonce; constant-time compare; purpose-bound so a checkout token can't verify as an invitation. |
| Session/API key/OTP storage | SHA-256 digests only. |
| In transit | TLS required in prod (HSTS `max-age=63072000; includeSubDomains; preload`). |

## 6. Payments, AI routing & webhooks

- Card data never touches the server (hosted Razorpay payment links / Stripe
  Checkout) — SAQ-A posture.
- Webhooks: signature verified **before any trust** (HMAC-SHA256 raw-body compare;
  Stripe scheme with timestamp tolerance to stop replay); candidates probed by
  config, failure = 400. `WebhookEvent(providerCode, externalId)` unique ⇒
  idempotent redelivery. Amounts clamped to invoice outstanding; refunds require
  `payment.refund` and cannot exceed unrefunded balance; refunds flow through the
  provider when the payment was gateway-captured.
- Sandbox-only `mock` provider is rejected in LIVE mode; keys validated by prefix
  vs mode (rzp_test/sk_test…) so a live key can never run as sandbox or vice versa.

## 6b. Idempotency & integrity

- `Idempotency-Key` (8-120 chars) on money POSTs: first result is stored (org-scoped, unique, 24h TTL) and replays return it with `idempotent-replayed: true`; same key + different body → 409; crash mid-request releases the key
- Every POST/GET carries `x-request-id` (honoured if supplied, UUID otherwise) for log correlation
- `/api/v1/health` (liveness + DB ping) for load balancers; `maintenance` SystemSetting returns 503 + operator message for all non-platform-admin traffic
- `@updatedAt` on every mutable table; money rows (Invoice/Payment/Refund) additionally carry status snapshots derived by the ledger, never set by clients

## 7. Abuse & availability

- DB-backed token buckets (portable, no Redis): auth 10/min/IP, API 120/min/identity
  (env-tunable); 429 + `Retry-After` details.
- Every request-scoped list endpoint is bounded (`pageSize ≤ 200`, capped
  date windows, `take` limits on aggregations).
- Outbound fetches (site audit, link check, gateways) have hard timeouts
  (`AbortSignal`), no redirect-yes-SSRF-elsewhere: audits limited to http(s) URLs.
- Entitlement gates double as load governors; **archived clients release plan seats** (capacity counts non-archived rows)
- Rate-limit buckets adopt config changes live (`maxTokens`/refill rewrite on conflict) — no stale-cap traps after rotating env values
- Cron endpoints stamp heartbeats (`SystemSetting cron:*`) surfaced by the readiness checklist with staleness thresholds

## 8. Response hardening (proxy.ts)

`Content-Security-Policy` (frame-ancestors 'none', object-src 'none',
form-action 'self', constrained script/frame sources incl. provider domains),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
(camera/mic/geo disabled, payment self), HSTS in production.
Next.js 16 **proxy** (middleware) applies headers; note the proxy is
defense-in-depth — authorization never depends on it.

## 9. Auditability

- Append-only `ActivityLog` written inside the *same transaction* as the mutation
  (trail and data can't diverge): login/fail, creates/updates/voids/refunds,
  role changes, gateway activation, report runs, sandbox settlements…
- Money trail immutability: payments/deletes guard against altering gateway
  records; invoices with payments can't be voided/deleted; clients with financial
  history can't be deleted (archive instead); projects with billed work can't be
  deleted.

## 10. Configuration & secrets

- `src/server/env.ts` zod-validates every variable at boot (fail-fast, no
  `undefined` drift); 32-byte key checks enforced.
- `.env` never committed (`.env.example` documents every variable); secrets are
  never returned by any API (gateway listing returns non-secret meta only —
  smoke asserts it).

## Notes & known limits

- `npm audit` advisories sit only in Prisma build-time tooling (`deepmerge-ts`
  parsing local configs; `mysql2` driver bundled but unused with Postgres) — no
  runtime exposure; pinned deliberately on Prisma 7.10 stable.
- 2FA/MFA (TOTP) slots exist in the model (`User`) — roadmap.
- Tag-template bodies are trusted admin-authored configuration (like email templates): values interpolated into them are allowlisted (`{{pixelId}}` etc. reject `<`, quotes); template authors are workspace/platform staff, not anonymous users.
- CSP requires `'unsafe-inline'` for scripts during dev (Next emits inline
  bootstrap); move to nonces in production edge deployments.
