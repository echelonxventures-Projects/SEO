# Development

## Prerequisites

- Node ≥ 20 (built & verified on Node 26)
- PostgreSQL 16 (local or `docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`)

## Setup

```bash
createdb omnimark
cp .env.example .env
# generate secrets:
#   openssl rand -base64 32   → OMNI_ENCRYPTION_KEYS {"1":"…"}
#   openssl rand -base64 32   → OMNI_TOKEN_SECRET
#   openssl rand -hex 24      → CRON_SECRET
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Seeded demo login: `founder@aithink.india` / `DemoPassword#1`.
Re-running `db:seed` is safe (idempotent upserts). Set `OMNI_SEED_DEMO=0` to seed
only reference data (currencies/GST/roles/plans), or `DEMO_PASSWORD` /
`DEMO_EMAIL` to change the demo account.

## Daily workflow

```bash
npm run typecheck      # strict tsc — zero errors required
npm run lint           # eslint — zero errors required (advisory warnings OK)
npm test:smoke         # 65-assertion API suite (needs running dev/prod server)
npx tsx scripts/smoke-pages.ts   # render-check all screens
npm run build          # production build gate
```

## Project layout

```
prisma/schema.prisma      data contract (51 models) — the source of the domain
prisma/seed.ts            global reference data + plans + RBAC + demo tenant
src/server/               env, db, errors, crypto, money, numbering, tokens,
                          ratelimit, audit, mail, sessions, context, api, pages
  catalogs/permissions.ts RBAC catalog (seed source; runtime reads DB grants)
  gateways/               provider plugin contract + razorpay/stripe/mock
  services/               domain logic — EVERY invariant lives here
src/app/api/v1/**         route handlers (mostly generated) — wiring only
src/app/(auth)/…          login/register/invite/reset/pay flows
src/app/(app)/…           tenanted app (shell layout guards auth + org)
src/components/           ui kit, CRUD engine, shell, charts, document builder
src/lib/                  client api() + formatters
scripts/gen-routes.mjs    API route generator spec (single source for std routes)
scripts/smoke*.ts         end-to-end verification suites
                          (SMOKE_SINK_HOST=host.docker.internal when the app
                          runs inside the compose stack; defaults to 127.0.0.1)
```

## Changing the API surface

Standard resource routes are generated. Add/modify an entry in
`scripts/gen-routes.mjs` (`R(path, { GET: { permission, svc, body }, … })`) and run
`node scripts/gen-routes.mjs`. Bespoke handlers (auth, webhooks, cron, checkout)
are hand-written beside them and never overwritten by the generator.

## Adding a module (recipe)

1. Model + relations in `prisma/schema.prisma` → `npm run db:migrate`.
2. Permission(s) in `catalogs/permissions.ts` → re-seed (grants update in DB).
3. Service fn in `src/server/services/*` with `ctxOf(viewer,ip)`, zod input
   validation, `assertWritable/requireOwned`, money via `computeLine/computeDocument`,
   numbering via `nextDocumentNumber`, and `audit()` in the same transaction.
4. Route entry (generator or hand-written) with the right `permission`.
5. Pixel/snippet work: template rows in `PixelTemplate` (seeded globals), values render via `{{placeholder}}` substitution with charset allowlisting.
6. Client screen reusing `ResourceScreen`/`CrudFormModal` + `api`.
7. Extend `scripts/smoke.ts` with assertions.

## Central scheduling contract

All recurrence/cadence semantics live in UTP assets. New domains that need
scheduling must reference a `TemporalPattern` (`patternId` FK) rather than
storing windows/cadences in their own JSON. Legacy shapes are kept as readable
fallbacks; `POST /api/v1/temporal/adopt-legacy` sweeps them into assets
(idempotent). `TemporalTrigger` can also ride an asset (`patternId` → `nextFireAt` computed
from the pattern stream). Platform-wide monitoring reads
`GET /api/v1/temporal/timeline` (merged cross-domain schedule) and
`GET /api/v1/temporal/monitor` (health score over crons, triggers, assets,
capacity, report runs); report cron is `POST /api/v1/cron/reports`. Seed
adopts legacy flight cadences at seed time (`prisma/seed-temporal.ts`).

**Frame rule (zero-bypass):** no service may call `materialize()` directly on
a stored pattern — everything goes through `expandPattern()` in
`temporal-frame.ts`, which resolves the pattern's bound `TimeSystem`
(planet/custom sol frames), applies the configured holiday calendar, and keeps
Earth-frame behaviour identical. Public surfaces (booking boards, ICS feeds)
are revocable via `temporal-share.ts` token registry (`Calendar.shareTokens`).

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | postgres://… |
| `APP_URL` | — | canonical origin; CSRF/origin + links |
| `NODE_ENV` | development | `Secure` cookies & HSTS gated on production |
| `OMNI_ENCRYPTION_KEYS` | — | JSON `{"1":"base64:32B"}` keyring |
| `OMNI_ENCRYPTION_KEY_VERSION` | 1 | active key version |
| `OMNI_TOKEN_SECRET` | — | HMAC for signed tokens (≥32B) |
| `OMNI_BCRYPT_ROUNDS` | 12 | |
| `OMNI_LOGIN_MAX_FAILURES` / `OMNI_LOGIN_LOCK_MINUTES` | 10 / 15 | |
| `OMNI_RATE_AUTH_PER_MIN` / `OMNI_RATE_API_PER_MIN` | 10 / 120 | |
| `SMTP_URL` / `MAIL_FROM` | unset | unset ⇒ mails logged, not dropped |
| `CRON_SECRET` | — | bearer for `/api/v1/cron/renew` + `publisher` + `email-dispatch` |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | unset | if present, the seeder registers them as platform AI routing configs (free tiers first, premium gated by `AI_PREMIUM`) |
| `OMNI_WEBHOOK_BASE_URL` | `APP_URL` | if API host differs |
| `DEMO_PASSWORD` / `DEMO_EMAIL` / `OMNI_SEED_DEMO` | — | seed only |

## UTP (Temporal domain) workflow

Engines live in `src/server/temporal/` (pure, no DB): `dsl.ts` (parse/validate/
optimize/plan), `recurrence.ts` (materializer), `constraints.ts`, `dependency.ts`,
`astronomy.ts`, `units.ts` + `tz.ts`. Services: `temporal.service.ts`
(calendars/patterns/events/agenda/config), `temporal-booking.service.ts`
(slots/appointments/waitlist), `temporal-resources.service.ts` (resources/
availability/workforce), `temporal-triggers.service.ts` (trigger engine +
execution pipeline), `temporal-intelligence.service.ts` (optimize/forecast/
analytics), `temporal-governance.ts` + `temporal-library.service.ts` (event
store, versions, rollback, library/holidays/fiscal/time systems).

Adding a temporal feature: extend the DSL grammar in `dsl.ts` → mirror it in
`recurrence.ts` → assert every spec line still compiles in `scripts/smoke.ts`
(GRAMMAR array) → seed reference data in `prisma/seed-temporal.ts`.

## Roadmap (beyond this build)

1. **Billing realism** — proration on mid-cycle plan switches; platform-side GST
   on tenant invoices (state-driven, engine already supports it); dunning emails.
2. **Real SERP providers** — implement `SerpProvider` adapters (SerpAPI/SerpDog)
   behind the existing registry; scheduled refreshes via the cron channel.
3. **Google/Meta ads sync** — metric pull into `CampaignMetric` (the schema +
   derived metrics already exist).
4. **Client portal** — approve-quote & pay links (checkout tokens exist) plus a
   scoped `CLIENT_VIEW` membership role.
5. **MFA** — TOTP secrets column slot exists on `User`; enroll at login.
6. **Files** — attachment storage for proposals/proofs (object storage bucket
   model is a single FK away).
7. **Ops** — OpenTelemetry spans in route wrapper; per-provider webhooks
   registration APIs (Razorpay supports via key); nightly `renewDueSubscriptions`
   + rank-refresh crons documented in README already.
8. **Multi-currency invoicing** — exchange-rate entity to bill clients in their
   currency while ledger stays base-currency.
9. **UTP event-stream transport** — DONE as data+HTTP-SINK adapter
  (`StreamTransport`, signed HMAC pushes, resumable (at,id) cursor, auto-pause).
  A Kafka/Pulsar bridge is one more `TransportKind` adapter pointing at any sink
  or bridging via Kafka Connect HTTP sink — no app contract change.
10. **UTP AI scheduling** — LLM-assisted cadence drafting that emits *validated
   DSL* (compile or reject), feeding the same optimizer/forecast engines.
