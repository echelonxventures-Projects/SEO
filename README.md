# OmniMark — Digital Marketing Platform (SaaS)

A multi-tenant platform to run an SEO / digital-marketing business end-to-end:
**everything sellable, billable, monitorable and analysable.**

| | |
|---|---|
| **Stack** | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 · Prisma 7 · PostgreSQL 16 |
| **Scale** | 125 entities / 103 enums · 288 API routes · 65 screens · constitutional domain layers |
| **Verified** | `npm run build` ✓ · `tsc --noEmit` ✓ · `eslint` 0 errors ✓ · **300/300 API smoke ×3 (prod mode)** · 300/300 ×3 against `docker compose` prod stack ✓ · **52/52 page renders** ✓ · webhook HMAC verified in-test ✓ |

## What it does

- **SaaS multi-tenancy** — workspaces (agencies) sign up, subscribe to plans, hit plan limits & feature gates; platform bills tenants with real invoices.
- **CRM** — leads pipeline (DB-configurable stages) → convert to clients; contacts, notes, owners.
- **Delivery** — projects, tasks with enforced status flow, timesheets, billable expenses.
- **Sales** — service catalog; quotes → accept → convert → invoices → payments → refunds.
- **Billing engine** — integer-only money (paise), GST tax groups (CGST+SGST / IGST derived from place-of-supply), DB-driven document numbering, printable invoices, online payment links.
- **Payments** — pluggable gateway layer: **Razorpay** (payment links + HMAC webhooks), **Stripe** (Checkout + signed webhooks), **Mock** (sandbox). Secrets envelope-encrypted (AES-256-GCM) at rest.
- **SEO tools** — keyword rank tracking (manual / CSV / provider plugin incl. labelled demo provider), backlink index with live liveness checks, real on-page **site audit engine** (20+ checks: indexability, title/meta/H1/canonical/viewport/OG/alt/robots/sitemap/performance) with weighted scoring.
- **Campaigns** — channel metrics (impressions/clicks/cost/conversions/revenue) with derived CTR/CPC/ROAS.
- **Temporal triggers ride assets** — a trigger can bind to a recurring `TemporalPattern` (next fire computed from the asset stream), so automations follow the same centrally-edited schedule as everything else.
- **Marketing execution** — social connections (real OAuth 2.0 for Facebook Pages / X PKCE / LinkedIn + sandbox demo channel, tokens envelope-encrypted & auto-refreshed; authorize/token/API hosts are per-workspace configuration with adapter defaults only as fallback), multi-channel content calendar with an atomic claim-based publisher (retries/backoff, per-target logs), tracked links (`/go/{code}` with campaign-derived UTMs + click counting), client web properties whose tag bundles render from **database `PixelTemplate` rows** (GA4/Meta/TikTok/LinkedIn/Pinterest seeded; add Clarity/Hotjar/any vendor by filling `{{pixelId}}` placeholders — zero code), email marketing (double opt-in, RFC-8058 one-click unsubscribe, batched cron dispatcher, open-tracking pixel).
- **AI Creative Studio** — blog drafts/outlines, ad-copy variant sets, social captions, timed voiceover scripts, image creatives, newsletters, keyword expansion. Outputs flow into blogs/creatives/posts with lineage back to the generation job.
- **AI routing is policy data, not code** — every provider is an `AiModelConfig` row with `priority` (attempt order) and optional `requiredFeature` (plan-feature gate). Free-tier engines (Google Gemini, Groq/OpenAI-compatible, …) run first for **every** plan; premium providers (OpenAI, Anthropic) carry `requiredFeature = AI_PREMIUM` and only become eligible on plans that include it — Starter workspaces never reach a metered API. A deterministic offline **demo engine** sits last so the whole pipeline works with zero external accounts. Generation fails over along the list and records which engine produced the output.
- **ONE temporal authority** — nothing keeps its own clock: campaign flight cadences are compiled into UTP `TemporalPattern` assets (legacy JSON cadence is auto-adopted on first slot run; a sweep endpoint centralizes the rest), report schedules run as UTP-driven recurring jobs (`nextScheduledAt` computed on save, `/cron/reports` executes due runs), `GET /temporal/timeline` merges **every** scheduled thing platform-wide, and `GET /temporal/monitor` scores the whole schedule estate (cron heartbeats, past-due/failing triggers, deprecated assets still in use, stale series horizons, oversubscribed resources, due report runs) — events, appointments, flights, publishes, sends, tasks, reports — into one monitored view. Recurrence caps, horizons, working days and retention are per-workspace configuration, not code.
- **Universal Temporal Platform (UTP)** — the calendar *is* a product: an enterprise temporal operating system where **schedules are reusable assets, never attributes**. Calendars (spaces, sharing, security, governance), a **TemporalPattern** asset model consumed by events/flights/content/triggers, a **Temporal DSL compiler** (parse → validate → optimize → plan; `EVERY WEEKDAY 09:00`, `FIRST MONDAY OF MONTH`, `LAST BUSINESS DAY OF QUARTER`, `AFTER EVENT(APPROVAL)+7D`, `AT SUNRISE`, `AFTER FULL_MOON`, `24x7`, unions, relative ranges…), a **recurrence engine** (secondly→yearly, set-position, custom rules, infinite streams materialized window-bounded), **events/series/occurrences with exception overrides**, **appointment lifecycle** (slot generation from patterns, capacity-atomic booking, auto waitlist promotion, reschedule, check-in), **resource scheduling** (rooms/equipment/vehicles/studios with capacity conflicts), **availability profiles + blackouts**, **workforce** (shifts, deterministic rotation generation, coverage-gap analysis), **constraint engine** (business hours / working days / holidays / compliance / capacity / custom, hard vs soft), **dependency engine** (FS/SS/FF/SF with lag resolution), **temporal triggers** (absolute/relative/event/astronomical/resource anchors, retry/backoff, exhaust caps) driven through a **universal execution pipeline** (validate→constraints→dependencies→availability→trigger→plan→execute) into real consumers (email, tasks, outbox webhooks, content, AI fabric), **planetary time systems with real scheduling**, and an **event-stream fabric** — the immutable log streams to HMAC-signed HTTP sinks (Kafka/Pulsar bridge-ready) with resumable cursors, auto-pause, one-command revoke; AI forecast insight rides the plan-gated studio routing — a pattern bound to `MARS_SOL` materializes on the sol clock (spacing 88,775 s, fires at 09:00 *sol time*; one sol = 24 system hours, week/month/quarter/year = 7/30/90/360 sols, verified round-trip through the conversion engine); **condition triggers** (`WHEN RESOURCE_AVAILABLE / CAPACITY_AVAILABLE / TEAM_AVAILABLE`) continuously resolve real free windows from bookings + shifts + blackouts and self-rearm each cron pass; unresolvable anchors are rejected at creation (no silent dead triggers); one-shot anchors exhaust after firing; **astronomical triggers locate via `geoRef` → `GeoLocation` (integer-microdegree coordinates)** falling back to the org's geocoded location; **revocable share tokens** — public booking links and **RFC 5545 ICS calendar feeds** (`/api/v1/public/feed/{token}`, webcal-importable) live in one registered token store per calendar — revoke-all kills every public surface at once; the configured `holidayCalendarId` (or a per-rule one) is honored across materialization, slots, booking and intelligence, **astronomical engine** (real NOAA sun/twilight/golden-hour + moon phases/equinoxes), a **Temporal Library** (industry/enterprise/holiday/fiscal templates instantiated by a button), **Temporal Intelligence** (best-slot optimization, auto-schedule, auto-replan, conflict detection, capacity forecasting), **Temporal Analytics** (merged-interval utilization, throughput, trends, ops), and **Temporal Governance** — an append-only `TemporalEventLog` event store with replay & time-travel, snapshot versioning with rollback, and retention sweeps.
- **Campaign composition systems (each a complete product)** — *Media channels* (`Channel`: kind/cost-model/capabilities + connection-aware readiness, platform catalog + workspace overrides), *Target bases* (`Audience`: CSV import with identity-dedupe & per-member consent, mailing-list sync, stats, archived-safe), *Calendar* (`CampaignFlight`: per-channel windows, approval → cadence slot generation → cron status sweep LIVE/ENDED, overlap conflict detection + a month grid), and a **guided wizard** (client → channels → audience → dates+cadence) that composes them in one transaction.
- **Platforms as data** — social networks are `ConnectorTemplate` rows: built-in code adapters (Meta, X, LinkedIn, demo) plus a generic OAuth2+JSON engine (mastodon & threads seeded as pure config — endpoints, field mappings). New network = a form, not a deploy.
- **UCOS constitutional backbone** — machine-readable domain registry (`GET /api/v1/registry` + `/system` page); transactional **domain-event outbox** with subscription patterns, HMAC-SHA256 signed webhook fan-out, retries, auto-pause; the **Offer domain** (approval lifecycle; atomic capped redemptions wired into invoice totals); the **Campaign Orchestrator lifecycle** — plan (validated references) → approval → simulation → launch → close → learn, owning nothing itself.
- **Analytics & reports** — dashboard KPIs + charts (revenue, campaigns, team hours, SEO movers), saved report builder (6 modules), immutable activity/audit trail.
- **Platform hardening** — `x-request-id` on every response, `/health` probe, `Idempotency-Key` replay protection on money POSTs (invoices/quotes/payments/subscribe/generate), TOTP 2FA with single-use recovery codes, session listing + revoke-others + password rotation that kills sessions, polymorphic tags on every core entity, platform-controlled maintenance mode (non-admins get 503 + message), full-workspace JSON export (data portability / GDPR), `@updatedAt` versioning across 47 tables, append-only audit inside every mutation transaction.
- **Security** — sessions with server-side revocation, per-session CSRF tokens + origin checks, DB-driven RBAC permission matrix (55 permissions × 5 roles), login lockout, scoped API keys, webhook signature verification + idempotency, DB-backed rate limiting, CSP/HSTS/anti-framing headers, row-level tenancy guards everywhere.

## Quick start

```bash
# 1. Database (local Homebrew Postgres or Docker)
createdb omnimark
# or: docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16

# 2. Environment
cp .env.example .env
# then generate real secrets:
#   openssl rand -base64 32   (x2 → OMNI_ENCRYPTION_KEYS v1 + OMNI_TOKEN_SECRET)
#   openssl rand -hex 24      (CRON_SECRET)

# 3. Install, migrate, seed
npm install
npm run db:migrate     # creates schema (45+ tables)
npm run db:seed        # reference data + plans + RBAC + demo workspace

# 4. Run
npm run dev            # http://localhost:3000
```

**Demo login** (from seed): `founder@aithink.india` / `DemoPassword#1`
(workspace *AIthink Digital* with clients, projects, ranks, campaigns, quotes, invoices).

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | strict tsc |
| `npm run lint` | eslint (0-error gate) |
| `npm run db:migrate` | prisma migrate dev |
| `npm run db:seed` | seed / re-seed (idempotent) |
| `npm run test:smoke` | 300-assertion API end-to-end suite (incl. full UTP battery) — set `SMOKE_SINK_HOST=host.docker.internal` to run it against the compose stack |
| `npx tsx scripts/smoke-pages.ts` | render-check all 52+52 screens |
| `npx prisma studio` | browse data |

## Scheduling

Cron endpoints (all require `Authorization: Bearer $CRON_SECRET`):
`/api/v1/cron/renew` (subscriptions + overdue sweeps),
`/api/v1/cron/publisher` (content calendar publishing),
`/api/v1/cron/email-dispatch` (email send batches),
`/api/v1/cron/flights` (campaign flight status sweep),
`/api/v1/cron/events` + `/cron/offers` (UCOS backbone), and UTP:
`/api/v1/cron/temporal-materialize` (extend recurring series to horizon),
`/api/v1/cron/temporal-triggers` (fire due temporal triggers with retries),
`/api/v1/cron/temporal-governance` (retention pruning + hold expiry),
`/api/v1/cron/temporal-stream` (event-fabric streaming), and
`/api/v1/cron/reports` (UTP-scheduled report runs).

Point provider webhooks at `/api/v1/webhooks/razorpay` and
`/api/v1/webhooks/stripe` (copy URLs from **Settings → Payments**).

## Deploying to production (fill-in-the-blank model)

Every external dependency ships as an **inactive placeholder row** — go-live is
replace-the-blank + activate, never code changes. The **Settings → top banner**
shows a live *production-readiness* score with every unfilled blank listed
(gateway, per-network social apps, AI providers, SMTP, cron heartbeats, plans).

1. **Environment** — copy `.env.example`, set: `NODE_ENV=production`,
   `DATABASE_URL` (managed Postgres with pooler ok), `APP_URL=https://…`,
   fresh `OMNI_ENCRYPTION_KEYS` (+ version), `OMNI_TOKEN_SECRET`,
   `CRON_SECRET`, `SMTP_URL`/`MAIL_FROM`.
   ⚠ Never reuse the dev keyring values; never seed demo in prod
   (`OMNI_SEED_DEMO` guard makes `npm run db:seed` reference-data-only under
   production unless `DEMO_SEED_OVERRIDE=1`).
2. **Migrate & seed** — `npx prisma migrate deploy && npm run db:seed`
   (creates currencies, GST groups, RBAC, plans, tag templates + placeholder
   gateway/AI blanks).
3. **Payments** — Settings → Payments: paste Razorpay key id/secret + webhook
   secret → activate. Point Razorpay/Stripe dashboards at the displayed
   `/api/v1/webhooks/{provider}` URLs.
4. **AI** — Settings → AI Studio: replace each `REPLACE-ME` key (Gemini free
   tier first; OpenAI/Anthropic stay plan-gated) → activate. Until then,
   generation transparently falls back to the offline demo engine.
5. **Social** — /social: create the Meta/X/LinkedIn apps with redirect
   `/api/v1/social/callback`, paste client id/secret, connect accounts.
6. **Cron** — schedule three heartbeats (readiness page tracks staleness):
   `POST /api/v1/cron/renew`, `/cron/publisher`, `/cron/email-dispatch`
   with `Authorization: Bearer $CRON_SECRET` (Vercel cron / k8s CronJob).
7. **Health** — LB probe `GET /api/v1/health`; liveness + DB check.

Local dev note: the repo lives on a Desktop that iCloud may sync — sync
artifacts (`… 2.ts` files inside `.next`) can corrupt Turbopack's dev cache.
If `next dev` crashes at boot: `pkill next; rm -rf .next; npm run dev`, or
just use `npm run build && npm run start`.

### One-command production boot

```bash
cp .env.example .env   # fill APP_URL, PG_PASSWORD, OMNI_*, CRON_SECRET
docker compose up --build -d   # postgres 16 + app (standalone build, migrate on boot)
docker compose exec -e DEMO_SEED_OVERRIDE=1 app npm run db:seed
```

Verified end-to-end: the full 300-assertion suite (incl. webhook HMAC fan-out and
event-stream pushes to a host-side receiver via `SMOKE_SINK_HOST=host.docker.internal`)
passes against exactly this compose stack.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layering, data model, money/tax engine, state machines, gateways, tenancy
- [docs/SECURITY.md](docs/SECURITY.md) — full security model & controls
- [docs/API.md](docs/API.md) — REST API reference, auth, errors, pagination
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — dev workflow, route codegen, env vars, roadmap

## Design commitments

- **Zero hardcoded business data** — currencies, tax rates, categories, pipeline stages, numbering patterns, plans, permissions & role grants all live in the database (`prisma/seed.ts` is the single source for global defaults).
- **Zero float money** — paise (`BigInt`) end to end; quantities ×100; percentages in basis points; GST splits use largest-remainder so CGST+SGST always equals the line tax exactly.
- **Zero partial endpoints** — every screen and route is implemented; nothing stubbed.
- **Schedules are assets** — no domain stores its own recurrence logic; events, flights, publishers and triggers all consume UTP temporal assets.
- **Every mutation audited** — append-only `ActivityLog` written inside the same transaction as the change.
- **Defense in depth** — API-key and session auth share one permission-checked service layer; row-level tenancy checks re-verify org ownership even after the gate passes.
