# Architecture

## Layering

```
Browser ── Server Components (read: services → Prisma)
       └─ Client Components ── api.ts ── /api/v1/** (Route Handlers)

route.ts ─▶ route() wrapper ─▶ Service fn (domain logic + state machines)
            │ authn · CSRF · origin · rate limit · permission · errors
            └▶ Prisma (typed, $transaction, PostgreSQL)
```

| Layer | Path | Responsibility |
|---|---|---|
| **UI** | `src/app/**/page.tsx` | Server components fetch via services directly; interactive tables/forms/modals are client components |
| **Shell** | `src/components/{shell,ui,crud,charts,document-builder}.tsx` | App frame, primitives, generic CRUD engine, recharts |
| **API** | `src/app/api/v1/**/route.ts` (96) | Thin, generated (see route codegen) — only wiring & validation dispatch |
| **Services** | `src/server/services/*` | ALL domain logic, invariants, state machines, auditing |
| **Core** | `src/server/{api,context,sessions,crypto,money,numbering,tokens,ratelimit,audit,mail,db,env,errors}.ts` | Cross-cutting primitives |
| **Gateways** | `src/server/gateways/{types,registry,razorpay,stripe,mock}.ts` | Payment provider plugin contract |
| **Contract** | `prisma/schema.prisma` | 51 models, 37 enums |

## Multi-tenancy & context

- `Organization` is the tenant. Users hold `Membership(userId, orgId, roleId)` —
  many workspaces per user. Active workspace lives in an httpOnly cookie and is
  *verified against memberships on every request* (`resolveViewer` → `Viewer.active`).
- Every tenant-owned row carries `orgId`; services never trust client-supplied
  tenant ids. `requireOwned(entity, label, orgId)` is the row-scope guard: missing
  or foreign rows both return `NOT_FOUND` (no IDOR existence leaks). Platform rows
  (`orgId = null`: global currencies, tax catalog, dictionary categories, PLATFORM
  gateways) pass the guard, with elevation checks where needed.
- `Ctx = { viewer, orgId, userId, ip }` is threaded explicitly into every service —
  the request context is a first-class parameter, not ambient state.

## Entity graph (summary)

- **Identity**: `User ─ Session/OtpToken/Invitation/ApiKey ─ Membership ─ Role ─ RolePermission ─ Permission`
- **Tenant**: `Organization ─ DocumentSequence · PipelineStage · Category · TaxRate · GeoLocation · Currency(default)`
- **CRM**: `Client ─ Contact · Note` ← `Lead ─ PipelineStage · Category(source)`, `Lead.convertedClient`
- **Delivery**: `Client ─ Project ─ ProjectMember · Task · TimeEntry · Expense · ProjectKeyword · SiteAudit · Campaign`
- **Sales**: `ServiceItem ─ QuoteLineItem/InvoiceLineItem`; `Quote ──convert──▶ Invoice ─ Payment ─ Refund`
- **SaaS billing**: `Plan ─ PlanFeature` ← `Subscription ─ BillingCycle ─(Invoice partyKind=TENANT)`
- **Payments**: `GatewayConfig(encrypted creds) ─ Payment/WebhookEvent`
- **SEO**: `Keyword ─ RankSnapshot`, `Backlink`, `SiteAudit ─ SiteAuditIssue`
- **Marketing**: `Campaign ─ CampaignMetric(date-unique)`
- **Ops**: `Report ─ ReportRun`, `ActivityLog`, `RateLimitBucket`, `SystemSetting`

Relationships are fully bi-directional in the schema (every relation has both
sides), `onDelete` cascades chosen per aggregate (owning rows cascade; financial
trail rows `restrict`/soft-delete).

## Money & tax engine (`src/server/money.ts`, `settings.service.resolveTax`)

- Money: `BigInt` minor units. Quantities: integer ×100. Rates: basis points.
  `computeLine` (gross → line discount → net → tax) and `computeDocument`
  (subtotal + componentized tax − document discount) are pure and unit-exact.
- `splitTaxAcrossComponents` distributes a line's tax across CGST/SGST with
  largest-remainder so components **always sum exactly** to the combined-rate tax;
  documents carry a `taxBreakdown` JSON snapshot for display/audit.
- Tax rate rows form **groups**: `GST_INTRA` (children CGST+SGST) / `GST_INTER`
  (child IGST) / `FLAT`. `resolveTax(org.state, client.state, taxExempt)` picks the
  effective group at document-creation time; both the *bps* and *components* are
  snapshotted onto each line so historical documents never drift when tax config
  changes.

## State machines (enforced in services, never trusted from clients)

- **Task**: BACKLOG→TODO→IN_PROGRESS→IN_REVIEW→DONE (+BLOCKED/CANCELLED edges);
  illegal transitions → 409.
- **Quote**: DRAFT→SENT→(ACCEPTED|DECLINED)→CONVERTED; only accepted converts;
  conversion creates the invoice inside one transaction and cross-links.
- **Invoice**: DRAFT→ISSUED→SENT→(PARTIALLY_PAID|PAID), *→OVERDUE (swept), VOID
  (only with zero payments). `paidMinor`/status are **derived by the ledger**
  (`settleInvoicePayment`/`recomputeInvoiceStatus`) — no handler sets them.
- **Payment**: only via `ledger.settleInvoicePayment` (manual, mock-settle,
  webhook — same funnel, atomic with numbering + invoice update).
- **Subscription**: TRIALING/ACTIVE →(missed cycle)→ PAST_DUE → GRACE_PERIOD →
  EXPIRED; renewal sweep invoices the next cycle.

## Document numbering

`DocumentSequence(orgId, kind, pattern, prefix, padding, nextValue)` — pattern
tokens `{PREFIX}{YEAR}{MONTH}{SEQ}`, reserved **atomically** inside the caller's
`$transaction` (`UPDATE … RETURNING`), so concurrency can't collide and rollbacks
don't burn numbers. Prefixes derive from the org's initials at creation.

## Payment gateway abstraction

`GatewayProvider` = `createCheckout · verifyWebhook(rawBody) · refund`. Providers
are pure plugins registered in `registry.ts`; configs are `GatewayConfig` rows
(scope PLATFORM/ORGANIZATION, mode SANDBOX/LIVE) whose credentials are
envelope-encrypted with AAD binding (`gateway:<scope>:<org>:<provider>`) so a
stored blob can't be replayed onto another entity. Razorpay/Stripe adapters are
real API clients (payment links / checkout sessions + HMAC webhook verification
with timing-safe compares + refunds). Mock provider = sandbox settlement through
the same ledger. Webhooks: signature-first, then `WebhookEvent(provider,id)`
unique insert = idempotency, clamped settlement, cycle/subscription updates —
all audited.

## SEO engines

- **Site audit**: real fetch of target URL + robots.txt + sitemap.xml with
  timeouts; 20+ weighted checks categorised (indexability/onpage/technical/
  content/social/performance/security); weighted score + per-issue rows stored.
- **Rank refresh**: provider registry (`SErpProvider`); the bundled **demo**
  provider is deterministic and snapshots are labelled `source=DEMO` — never
  disguised as real SERP data. Manual + CSV (`term,position,capturedOn[,device]
  [,location]`) inputs create keywords/locations on demand.

## Route codegen

`scripts/gen-routes.mjs` is a declarative spec of all standard resource routes
(permission code + service call per method). It regenerates
`src/app/api/v1/**/route.ts` deterministically so handlers stay uniform; bespoke
routes (auth, webhooks, cron, switch-org) are hand-written beside them.

## Rendering & caching

No Cache Components (opt-in feature) — all tenant data reads are request-time
(`dynamic = "force-dynamic"` on data pages); mutations refresh via
`router.refresh()`. Sessions are resolved server-side from cookies
(`next/headers`), so there is no client-trusted auth state.

## AI provider routing (fully data-driven)

`src/server/ai/registry.ts` resolves an **ordered candidate list** per
capability (text/image/audio): org-scoped configs first (workspace autonomy),
then ascending `AiModelConfig.priority`; any config with `requiredFeature` set
is skipped unless the tenant's current plan grants that `FeatureCode`. The seed
registers free-tier engines (Gemini, Groq/OpenAI-compatible) at priority 10-20,
premium (OpenAI/Anthropic, `requiredFeature=AI_PREMIUM`) at 40-50, and the
offline demo engine at 999. Generation attempts candidates in order and falls
through on provider errors, so a bad/expired key degrades gracefully to the
next engine (ultimately the always-available demo). Keys are envelope-encrypted
(AAD `ai:<scope>:<provider>:<rowId>`) and never leave the server — Settings
shows a non-secret routing preview via `/api/v1/studio/routing`.

## Campaign systems as composable products

`Channel` (media), `Audience` (target bases) and `CampaignFlight` (calendar) each
own their model, services, routes and screens; they reference each other by
soft keys/ids, never shared mutable state. The wizard composes them in one
transaction; `ConnectorTemplate` + the generic OAuth2 engine (in
`src/server/connectors/engine.ts`) make every social platform configuration —
built-in adapters only exist where a provider's handshake is exotic.

## UCOS constitution & the event spine

- `src/server/constitution.ts` is the §18 blueprint in code: every domain ships
  a manifest (schema, rules, workflows, governance, events emitted/consumed,
  API contracts) served publicly at `/api/v1/registry` and visualized at
  `/system`. Adding a domain means shipping its manifest — consumers read the
  registry, they never hardcode domain lists.
- `src/server/events.ts` is the §13 event layer: `emit()` writes a transactional
  outbox row inside the same `$transaction` as the state change (no phantom or
  lost events); a dispatcher cron fans matching events to subscriptions (exact,
  `prefix.*`, or `*`), delivers HMAC-signed POSTs (`x-omni-signature:
  sha256=HMAC(ts.body)`), with bounded retries, failure counts, auto-pause at
  12 consecutive failures, and purge of deactivated subscribers' backlog.
- `Offer` (§10): DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED → ACTIVE →
  EXPIRED with approval separation-of-duty, atomic capped redemptions
  (identity = sha256 of email/client), and invoice integration (`offerCode` on
  create → redeem → discount folded into document totals + `offer.redeemed`).
- `orchestrator.service.ts` (§4): campaign lifecycle PLANNED → PENDING_APPROVAL
  → APPROVED → LIVE → CLOSED → LEARNED; *plan* validates every reference against
  its owning domain; launch cascades into Calendar; learn persists deterministic
  retrospectives (`LearningsSnapshot`) and emits `campaign.learned`.

## Vendor protocols as configuration

- **Tag templates** (`PixelTemplate`) hold every snippet shape — the seeded
  globals mirror GA4/Meta/TikTok/LinkedIn/Pinterest, and any new vendor is a
  row with `{{pixelId}}/{{label}}/{{domain}}/{{name}}/{{propertyId}}`
  placeholders. Org rows override global ones by `key` (same precedence rule
  as AI routing). Values substituted through a strict allowlist charset so a
  mis-entered tag id can never inject markup.
- **Social app configs** carry optional `authorizeUrl` / `tokenUrl` /
  `apiBase` / extra-header overrides consumed by the Facebook/X/LinkedIn
  adapters; the adapter constants are provider protocol defaults used only
  when the blanks are empty. Graph-version bumps and proxy gateways are
  config edits, not deploys.

## UTP — the Universal Temporal Platform (calendar-as-product)

The temporal domain (`src/server/temporal/*` engines, `temporal*.service.ts`,
`prisma/schema.prisma` §UTP) is a full calendar & scheduling OS that every
other domain *consumes*:

- **Assets, not attributes.** `TemporalPattern` holds a declarative `spec`
  (RFC-like: freq/interval/weekdays/monthdays/setPos/until/count) plus the
  original DSL text. Series masters, calendars, resources, availability
  profiles and triggers all reference patterns; editing a pattern re-versions
  it (`TemporalExpression` per compile, `TemporalVersion` snapshots).
- **DSL compiler** (`temporal/dsl.ts`): total, case-insensitive grammar →
  `pattern | trigger | range` artifact → `validateSpec` → `optimizeSpec` →
  `planExecution` (streaming vs bounded + step size). The studio endpoint
  (`POST /temporal/dsl/compile`) returns AST, diagnostics and a materialized
  preview — same code path used by `createPattern`.
- **Recurrence** (`temporal/recurrence.ts`): zone-local wall-clock expansion
  through `tz.ts` (Intl two-pass, DST-safe), secondly→yearly, set-position
  (FIRST MONDAY / LAST FRIDAY), custom named rules (LAST BUSINESS DAY OF
  QUARTER…), infinite recurrences materialized strictly window-bounded;
  holiday & working-day masks applied at generation, overrides (skip/move)
  applied at persistence (`EventOccurrence` rows + `overrides` on the master).
- **Constraint engine** (`temporal/constraints.ts`): rule rows evaluated
  against concrete intervals — hard violations block writes, soft ones warn.
  Slot generation, booking and the execution pipeline all share this evaluator.
- **Execution spine**: `runExecutionPipeline` records every stage as a step in
  `ExecutionPlan`; consumers are real adapters (mail send, task creation,
  outbox fan-out, content/billing signals). Trigger cron resolves
  `nextFireAt` (time systems incl. astronomical `AT SUNRISE` via `astronomy.ts`)
  with retry/backoff and exhaust caps.
- **Event sourcing**: `TemporalEventLog` is append-only (per-aggregate `seq`);
  `govern()` writes log + version snapshot inside each mutation transaction.
  Replay = fold forward; time-travel = `snapshotAt`; retention sweep prunes
  per-org — audit/compliance/GDPR all read the same store.
- **Planetary time**: `TimeSystem` rows (LINEAR_OFFSET / ROTATION / CUSTOM) +
  `units.ts` BigInt micro transforms — Mars Sol and lunar cycles are data.

## Why this stack

The brief said "stack agnostic". Chosen for a data-heavy multi-tenant SaaS:
one deployable, full-stack TypeScript codebase (no API/UI drift), React Server
Components for direct DB reads, route handlers for the public API surface
(machines + future mobile), Prisma for a typed relational contract (billing is
relational by nature), recharts for analytics. No Redis required (DB-backed rate
limiter); `DATABASE_URL` is the only hard dependency.
