# REST API

Base: `/api/v1` · JSON only · all responses enveloped.

## UTP (Universal Temporal Platform)

All under `/api/v1`. Permission column in brackets.

| Group | Endpoints |
|---|---|
| Calendars | `GET/POST /temporal/calendars` [temporal.read/write] · `GET/PATCH/DELETE /temporal/calendars/{id}` · `POST /temporal/calendars/{id}/share` · `DELETE /temporal/calendars/{id}/shares/{shareId}` · `GET /temporal/agenda?from&to` |
| Patterns | `GET/POST /temporal/patterns` · `GET/PATCH/DELETE /temporal/patterns/{id}` · `GET /temporal/patterns/{id}/preview?from&days&max` · `POST /temporal/patterns/{id}/deprecate` · `POST /temporal/dsl/compile` (stateless studio) |
| Events | `GET/POST /temporal/events` · `GET/PATCH/DELETE /temporal/events/{id}` · `POST /temporal/events/{id}/extend` · `POST /temporal/events/{id}/resolve` (dependency engine) · `POST /temporal/occurrences/{id}/cancel` · `POST /temporal/occurrences/{id}/move` |
| Dependencies | `GET/POST /temporal/dependencies` · `DELETE /temporal/dependencies/{id}` |
| Booking | `GET /temporal/calendars/{id}/booking-link` [appointment.manage] → token; `GET/POST /public/booking/{token}` (auth-free public slot board + booking) · `POST /temporal/slots/generate` [appointment.manage] · `GET /temporal/slots/open?calendarId` [appointment.read] · `POST /temporal/appointments/book` [appointment.book, `Idempotency-Key`] · `POST /temporal/appointments/waitlist` · `GET /temporal/appointments[/{id}]` · `POST /temporal/appointments/{id}/{confirm\|cancel\|checkIn\|complete\|noShow}` · `POST /temporal/appointments/{id}/reschedule` |
| Resources | `GET/POST /temporal/resources` · `PATCH /temporal/resources/{id}` · `POST /temporal/resources/{id}/book` [`Idempotency-Key`] · `GET /temporal/resources/{id}/conflicts` · `POST /temporal/bookings/{id}/release` |
| Availability | `GET/POST /temporal/availability` · `DELETE /temporal/availability/{id}` · `POST /temporal/availability/{id}/blackouts` · `GET /temporal/availability/preview?subjectType&subjectId&days` |
| Workforce | `GET/POST /temporal/workforce/shifts` · `POST /temporal/workforce/assign` · `GET /temporal/workforce/assignments[?userId&from]` · `DELETE /temporal/workforce/assignments/{id}` · `POST /temporal/workforce/rotate` · `GET/POST /temporal/workforce/coverage` |
| Triggers | `GET/POST /temporal/triggers` · `POST /temporal/triggers/{id}/toggle` · `POST /temporal/triggers/{id}/arm-on-event` · `GET /temporal/triggers/{id}/fires` · `GET /temporal/executions` |
| Governance | `GET /temporal/governance/versions/{entityType}/{entityId}` · `GET /temporal/governance/replay/{entityType}/{entityId}[?at=]` · `POST /temporal/governance/rollback` [temporal.manage] · `GET /temporal/governance/events` |
| Library | `GET /temporal/library` · `POST /temporal/library/{id}/instantiate` · `GET/POST /temporal/rules` · `PATCH/DELETE /temporal/rules/{id}` · `GET/POST /temporal/holidays` · `GET /temporal/holidays/{id}` · `GET/POST /temporal/fiscal` · `GET /temporal/fiscal/period?code&at` |
| Time systems | `GET /temporal/time-systems` · `POST` [temporal.manage] · `GET /temporal/time-systems/convert?code&at` |
| Feeds & tokens | `GET /temporal/calendars/{id}/feed-link` (ICS token) · `GET/DELETE /temporal/calendars/{id}/share-tokens` (list/revoke-all) · `GET /public/feed/{token}` → `text/calendar` (RFC 5545, revocable) |
| Intelligence | `POST /temporal/intelligence/optimize` · `POST .../auto-schedule` · `POST .../replan` · `GET .../conflicts` · `GET .../forecast?calendarId&weeks` |
| Analytics | `GET /temporal/analytics?days` · `GET /temporal/analytics/trends?days` |
| Config | `GET/POST /temporal/config` |
| Streams | `GET/POST /temporal/stream/transports` [temporal.read/manage] · `POST .../{id}/toggle` · `POST .../{id}/reset {from}` · `DELETE .../{id}` |
| TPaaS | `GET/POST /temporal/widgets` · `/widgets/{id}` · `/toggle` · `/rotate` · `GET/POST /public/widget/{token}` · `GET/POST /temporal/connectors[/templates]` · `/connectors/{id}/sync` · `GET/POST /temporal/marketplace` · `/publish` · `/retire` · `/certify` · `/install` · `/install`s` · `GET /temporal/metering/{summary,events}` · `POST /temporal/metering/prices` · `GET/POST /temporal/branding` · `GET/POST /temporal/locales` · `GET /temporal/locales/strings` · `GET /public/branding` · `POST /temporal/graphql` · `GET /temporal/sdk?language=` · `GET /temporal/sdk/targets` · `/public/widget.js` · `/embed/{token}` |
| Cron | `POST /cron/temporal-materialize` · `/cron/temporal-triggers` · `/cron/temporal-governance` · `/cron/temporal-stream` · `/cron/reports` · `/cron/calendar-sync` (Bearer `$CRON_SECRET`) |

## Auth methods

1. **Session cookie** (`omnimark_session`, httpOnly) — browser. Writes must also
   send `x-csrf-token` (value = the `omnimark_csrf` cookie) and a same-origin
   `Origin` header.
2. **API key** — `Authorization: Bearer omni_<secret>`. Tied to its workspace;
   `scopes` restrict to a permission subset (empty = creator's role grants).
   Create in **Settings → API keys** (shown once).

## Envelope & errors

```jsonc
// success
{ "data": … }                      // 200 / 201
// error
{ "error": { "code": "FORBIDDEN", "message": "Missing permission: invoice.write", "details?": … } }
```

| Code | HTTP |
|---|---|
| VALIDATION | 422 (details: `[{path,message}]`) |
| UNAUTHENTICATED · INVALID_CREDENTIALS | 401 |
| FORBIDDEN · CSRF_FAILED · ORG_MISMATCH | 403 |
| NOT_FOUND (incl. cross-tenant) | 404 |
| CONFLICT · ILLEGAL_STATE | 409 |
| ACCOUNT_LOCKED | 423 |
| PLAN_LIMIT | 402 |
| RATE_LIMITED | 429 (`details.retryAfterSeconds`) |
| SERVICE_UNAVAILABLE (maintenance) | 503 |
| PROVIDER_NOT_CONFIGURED | 503 · GATEWAY_ERROR 502 |

**Headers** — every response carries `x-request-id`; POSTs to `/invoices`, `/quotes`, `/payments`, `/billing/subscribe`, `/studio/generate`, `/campaigns/*/metrics` accept `Idempotency-Key: <8-120 chars>` (replays return the stored result with `idempotent-replayed: true`).

**2FA** — `POST /auth/login` may answer `{ data: { mfaRequired: true }, meta: { token } }`; complete with `POST /auth/mfa { token, code }` (TOTP or recovery code). Manage via `POST /auth/totp/begin|confirm|disable`, `POST /auth/change-password`, `GET/DELETE /auth/sessions`.

Lists accept `?page=1&pageSize=50&q=search&status=ACTIVE&clientId=…`
(max pageSize 200) and return `{ rows, total, page, pageSize }`.

## Endpoints (by module)

**Auth** — `POST auth/register · auth/login · auth/logout · auth/forgot-password ·
auth/reset-password · auth/verify-email · auth/org/switch/{orgId} ·
auth/invitations/{token}/accept · GET auth/invitations/{token} · GET auth/me`

**Clients/CRM** — `GET|POST /clients` · `GET|PATCH|DELETE /clients/{id}` ·
`POST /clients/{id}/contacts` · `PATCH|DELETE /contacts/{id}` ·
`GET|POST|DELETE /notes/{entityType}/{entityId}` ·
`GET|POST /leads` · `POST /leads/{id}/move` · `POST /leads/{id}/convert` ·
`DELETE /leads/{id}` (mark lost)

**Projects/tasks/time/expenses** — `GET|POST /projects` ·
`GET|PATCH|DELETE /projects/{id}` · `POST /projects/{id}/members` ·
`GET|POST /tasks` · `PATCH|DELETE /tasks/{id}` ·
`GET|POST /time` · `PATCH|DELETE /time/{id}` ·
`GET|POST /expenses` · `PATCH|DELETE /expenses/{id}`

**Sales** — `GET|POST /catalog/services` · `PATCH /catalog/services/{id}` ·
`GET|POST /quotes` · `GET /quotes/{id}` · `POST /quotes/{id}/send|decision|convert` ·
`DELETE /quotes/{id}` · `GET|POST /invoices` · `GET /invoices/{id}` ·
`POST /invoices/{id}/issue|send|void|checkout|unbilled` · `DELETE /invoices/{id}` ·
`GET|POST /payments` · `POST /payments/{id}/refund` · `DELETE /payments/{id}`

**Billing (platform↔tenant)** — `GET /billing/subscription` ·
`POST /billing/subscribe` · `POST /billing/cancel|resume` ·
`POST /billing/invoices/{id}/checkout` · `GET /public/plans`

**SEO** — `GET|POST /seo/keywords` · `DELETE /seo/keywords/{id}` ·
`POST /seo/snapshots` · `POST /seo/snapshots/import` (text/csv) ·
`POST /seo/snapshots/refresh` · `GET /seo/summary` ·
`GET|POST /seo/backlinks` · `POST /seo/backlinks/{id}/check` ·
`GET|POST /seo/audits` · `GET /seo/audits/{id}`

**Campaigns** — `GET|POST /campaigns` · `GET|PATCH /campaigns/{id}` ·
`POST /campaigns/{id}/metrics`

**Analytics** — `GET /analytics/overview?months=12` ·
`GET|POST /reports` · `POST /reports/preview` · `POST /reports/{id}/run` ·
`DELETE /reports/{id}` · `GET /activity`

**Team & settings** — `GET /team/members` · `POST /team/invitations` ·
`DELETE /team/invitations/{id}` · `POST /team/members/{id}/role` ·
`DELETE /team/members/{id}` · `PATCH /settings/org` ·
`GET /settings/permissions|currencies|sequences|geolocations` ·
`GET|POST /settings/{tax-rates|categories|stages|gateways}` (+ item PATCH/DELETE,
gateway `activate|deactivate`) · `GET|POST /apikeys` · `POST /apikeys/{id}/revoke`

**Channels** — `GET|POST /channels` · `POST /channels/{id}/toggle`
**Audiences** — `GET|POST /audiences` · `GET /audiences/{id}` · `DELETE` (archive-safe) · `GET|POST /audiences/{id}/members` · `DELETE …/members/{memberId}` · `POST …/import` (text/csv) · `POST …/sync`
**Calendar** — `GET|POST /flights` · `PATCH /flights/{id}` · `POST /flights/{id}/approve|cancel|slots` · `GET /calendar?from&to` · `POST /cron/flights`
**Connectors** — `GET /social/networks` (templates + app state) · `POST /social/templates` (add any OAuth2 platform) · `POST /social/templates/{id}/toggle` · `POST /social/connect {connectorKey}` · **Wizard** — `POST /campaigns/wizard`
**UCOS** — `GET /registry` (constitution, public) · `GET /events` · `GET|POST /events/subscriptions` · `DELETE /events/subscriptions/{id}` (pause/resume) · `GET …/deliveries` · `GET|POST /offers` · `GET /offers/{id}` · `POST /offers/{id}/status` · `GET /campaigns/{id}/orchestration` · `POST /campaigns/{id}/plan|transition|simulate|learn` · cron `/events`, `/offers` (Bearer CRON_SECRET); invoice create accepts `offerCode`

**Tags** — `GET|POST /tags` · `POST /tags/assign` · `GET /tags/entities?entityType=&entityId=` (also `tags: ["a","b"]` on client create, `?tag=` filter)
**Platform** — `GET /health` · `GET /settings/readiness` (production blank checklist) · `GET|POST /settings/maintenance` (platform admin) · `GET /settings/data-export` (full workspace JSON)
**Machine** — `POST /webhooks/{razorpay|stripe}` (signed) ·
`POST /cron/renew` (`Bearer $CRON_SECRET`) · `POST /public/pay/{token}` (checkout capability)

### Money formats

All monetary values are **minor units (paise)** integers. Quantities are
`qtyHundredths` (×100). Rates are basis points (`1800` = 18%). Tax documents
carry a component `taxBreakdown` snapshot.

### Examples

```bash
# register + auto-login (sets cookies)
curl -i -X POST localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@acme.in","password":"Str0ng#Pass!23","orgName":"Acme Digital"}'

# API-key list clients
curl localhost:3000/api/v1/clients -H "Authorization: Bearer omni_<secret>"

# create invoice (server recomputes all money)
curl -X POST localhost:3000/api/v1/invoices \
  -H 'content-type: application/json' -b "$JAR" -H "x-csrf-token: $CSRF" \
  -d '{"clientId":"…","lines":[{"description":"SEO retainer","qty":1,"unitPrice":14999,"taxRateId":"<GST18 group id>"}]}'
```
