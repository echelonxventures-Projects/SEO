# Service Layer Contracts

This document defines the boundaries, interfaces, and invariants of the domain services.

## Core Principles

1. **Services are the single source of truth** for domain logic
2. **No direct Prisma access from API routes** - all data operations go through services
3. **Transactions are explicit** - services define what operations must be atomic
4. **Context is threaded explicitly** - `Ctx { viewer, orgId, userId, ip }` passed to every service
5. **All mutations are audited** - append-only ActivityLog in same transaction

---

## Billing Services

### `billing.service.ts`

**Responsibility**: Payment gateway management, subscription lifecycle, checkout flow

**Public Interface**:
```typescript
// Gateway configuration
upsertGatewayConfig(ctx: Ctx, input: GatewayUpsertInput): Promise<GatewayConfig>
activateGatewayConfig(ctx: Ctx, id: string): Promise<void>
deactivateGatewayConfig(ctx: Ctx, id: string): Promise<void>
deleteGatewayConfig(ctx: Ctx, id: string): Promise<void>

// Plans & subscriptions
listPublishedPlans(): Promise<Plan[]>
subscribe(ctx: Ctx, input: SubscribeInput): Promise<{ subscriptionId: string; trialing: boolean }>
cancelSubscription(ctx: Ctx, input: CancelInput): Promise<void>
resumeSubscription(ctx: Ctx): Promise<void>
getBillingState(ctx: Ctx): Promise<BillingState>

// Checkout
checkoutTenantInvoice(ctx: Ctx, invoiceId: string): Promise<CheckoutUrl>
checkoutClientInvoice(ctx: Ctx, invoiceId: string): Promise<CheckoutUrl>

// Webhooks
processWebhook(providerCode: string, rawBody: string, headers: Headers): Promise<{ handled: boolean; reason?: string }>

// Renewal cron
renewDueSubscriptions(): Promise<RenewalResult>
```

**Invariants**:
- Gateway credentials are always encrypted with AAD-binding
- Subscription status transitions: TRIALING/ACTIVE → PAST_DUE → GRACE_PERIOD → EXPIRED
- Platform billing invoices created automatically on non-trial subscription start
- Tenant invoices (client-facing) never auto-created - only manual or quote conversion

**Dependencies**: `ledger.ts`, `numbering.ts`, `gateway registry`

---

### `ledger.ts`

**Responsibility**: Payment recording, invoice status computation

**Public Interface**:
```typescript
settleInvoicePayment(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string
    invoiceId: string
    clientId?: string
    amountMinor: bigint
    currencyCode: string
    method: PaymentMethod
    paidAt: Date
    reference?: string
    note?: string
    gatewayConfigId?: string
    gatewayPaymentRef?: string
    recordedByUserId: string
  }
): Promise<void>

recomputeInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: string): Promise<{ status: InvoiceStatus; paidMinor: bigint }>
```

**Invariants**:
- Invoice status is DERIVED from paidMinor vs totalMinor - never set directly
- Payments are recorded BEFORE invoice status updates (same transaction)
- Partial payments set status to PARTIALLY_PAID
- Full payments set status to PAID
- Overdue payments (past dueDate) set status to OVERDUE

**Dependencies**: `money.ts`, `numbering.ts`

---

## Money & Tax

### `money.ts`

**Responsibility**: All currency/tax calculations

**Public Interface**:
```typescript
computeLine(
  priceMinor: bigint,
  qtyHundredths: number,
  discountBps: number,
  taxBps: number
): { lineTotalMinor: bigint; taxMinor: bigint; discountMinor: bigint }

computeDocument(
  lines: { lineTotalMinor: bigint; taxMinor: bigint; discountMinor: bigint }[],
  documentDiscount: bigint,
  taxBreakdown: Json
): { subtotalMinor: bigint; taxMinor: bigint; discountMinor: bigint; totalMinor: bigint; taxBreakdown: Json }

splitTaxAcrossComponents(
  taxMinor: bigint,
  kind: TaxRateKind
): { cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint }

resolveTax(
  orgState: string | undefined,
  clientState: string | undefined,
  taxExempt: boolean
): { kind: TaxRateKind; rateBps: number }
```

**Invariants**:
- All money is `BigInt` minor units - never floats
- `cgstMinor + sgstMinor = taxMinor` (exact sum guaranteed)
- Tax rates are snapshotted on document creation - historical documents never drift

---

## Core Services

### `common.ts`

**Responsibility**: Shared primitives used across all services

**Public Interface**:
```typescript
// Context type
type Ctx = { viewer: Viewer; orgId: string; userId: string; ip: string }

// Row-level tenancy guards
requireOwned<T>(entity: T | null, label: string, orgId: string): Promise<T>
assertWritable(orgId: string): Promise<void>

// Auditing
audit(tx: PrismaClient, ctx: Ctx, action: string, entityType?: string, entityId?: string, meta?: Record<string, unknown>): Promise<void>

// Activity logging
logActivity(tx: PrismaClient, activity: ActivityLogInput): Promise<void>
```

**Invariants**:
- `requireOwned()` returns NOT_FOUND for both missing AND foreign rows (no IDOR leaks)
- All mutations call `audit()` within same transaction

---

## Temporal Services (UTP)

### `temporal.service.ts`

**Responsibility**: Calendar domain, pattern assets, event management

**Public Interface**:
```typescript
// Calendars
createCalendar(ctx: Ctx, input: CalendarInput): Promise<Calendar>
updateCalendar(ctx: Ctx, id: string, input: Partial<CalendarInput>): Promise<Calendar>
deleteCalendar(ctx: Ctx, id: string): Promise<void>
listCalendars(ctx: Ctx): Promise<Calendar[]>

// Patterns (reusable schedules)
createPattern(ctx: Ctx, input: PatternInput): Promise<TemporalPattern>
compilePattern(input: { dsl: string }): Promise<{ ast: any; diagnostics: string[] }>

// Events
createEvent(ctx: Ctx, input: EventInput): Promise<ScheduledEvent>
updateEvent(ctx: Ctx, id: string, input: Partial<EventInput>): Promise<ScheduledEvent>
getAgenda(ctx: Ctx, from: Date, to: Date): Promise<ScheduledEvent[]>
```

**Invariants**:
- Patterns are VERSIONED - editing creates new version, doesn't mutate existing
- Events consume patterns - if pattern changes, events materialize new occurrences
- Materialization is WINDOW-BOUNDED (default 400 days)
- Series masters track patternId - occurrences reference the master

**Dependencies**: `temporal/dsl.ts`, `temporal/recurrence.ts`, `temporal-governance.ts`

---

## CRM Services

### `crm.service.ts`

**Responsibility**: Clients, leads, contacts, notes

**Public Interface**:
```typescript
listClients(ctx: Ctx, filters: ClientFilters): Promise<Paginated<Client>>
createClient(ctx: Ctx, input: ClientInput): Promise<Client>
updateClient(ctx: Ctx, id: string, input: Partial<ClientInput>): Promise<Client>
archiveClient(ctx: Ctx, id: string): Promise<void> // Soft delete

convertLead(ctx: Ctx, id: string, input: LeadConvertInput): Promise<Client>
```

**Invariants**:
- Clients with financial history CANNOT be deleted - must archive
- Lead conversion creates Client + links existing project/quotes
- Notes are polymorphic - can attach to Client, Lead, Project, Task, Invoice, Quote, Campaign

---

## Delivery Services

### `delivery.service.ts`

**Responsibility**: Projects, tasks, time entries, expenses

**Public Interface**:
```typescript
listProjects(ctx: Ctx, filters: ProjectFilters): Promise<Paginated<Project>>
updateTaskStatus(ctx: Ctx, id: string, newStatus: TaskStatus): Promise<Task>
createTimeEntry(ctx: Ctx, input: TimeEntryInput): Promise<TimeEntry>
createExpense(ctx: Ctx, input: ExpenseInput): Promise<Expense>
```

**Invariants**:
- Task status transitions follow state machine - invalid transitions return 409
- Time entries can be converted to invoice lines (creates link, doesn't duplicate)
- Expenses can be billable - when billable, must reference invoice line or be pending

---

## Sales Services

### `sales.service.ts`

**Responsibility**: Quotes, invoices, refunds

**Public Interface**:
```typescript
// Quotes
createQuote(ctx: Ctx, input: QuoteInput): Promise<Quote>
sendQuote(ctx: Ctx, id: string): Promise<Quote>
acceptQuote(ctx: Ctx, id: string): Promise<Quote>
convertQuote(ctx: Ctx, id: string): Promise<Invoice> // Creates invoice in transaction

// Invoices (manual)
createInvoice(ctx: Ctx, input: InvoiceInput): Promise<Invoice>
issueInvoice(ctx: Ctx, id: string): Promise<Invoice>
voidInvoice(ctx: Ctx, id: string, reason: string): Promise<Invoice> // Only if no payments
```

**Invariants**:
- Quote conversion creates Invoice INSIDE same transaction - either both succeed or both fail
- Invoice status flows: DRAFT → ISSUED → SENT → PAID/PARTIALLY_PAID/OVERDUE
- Invoices with payments CANNOT be voided - must create refund
- Document numbering is ATOMIC (inside transaction) - no gaps, no collisions

---

## SEO Services

### `seo.service.ts`

**Responsibility**: Keyword tracking, backlink index, site audits

**Public Interface**:
```typescript
// Rankings
createKeyword(ctx: Ctx, input: KeywordInput): Promise<Keyword>
importRankingsCSV(ctx: Ctx, csv: string): Promise<{ created: number; updated: number }>

// Backlinks
trackBacklink(ctx: Ctx, input: BacklinkInput): Promise<Backlink>
checkBacklinkHealth(ctx: Ctx, id: string): Promise<Backlink>

// Site audits
requestAudit(ctx: Ctx, input: AuditInput): Promise<SiteAudit>
getAuditIssues(ctx: Ctx, auditId: string): Promise<SiteAuditIssue[]>
```

**Invariants**:
- All ranking sources are labeled (MANUAL/CSV/PROVIDER/DEMO)
- Backlinks are unique per org + sourceUrl + targetUrl
- Site audits are async - return 202 with status polling URL
- Weighted scoring: critical issues hurt score more than warnings

---

## Temporal Governance (Cron Jobs)

### `temporal-governance.ts`

**Responsibility**: Schedule health monitoring

**Public Interface**:
```typescript
govern(ctx: Ctx): Promise<GovernanceReport>
```

**Returns**:
```typescript
interface GovernanceReport {
  deprecatedPatterns: TemporalPattern[]      // Still in use but marked deprecated
  staleSeries: { patternId: string; lastSeenAt: Date }[]  // No occurrences materialized
  oversubscribedResources: Resource[]        // Capacity exceeded
  dueReportRuns: Report[]                     // Scheduled reports needing execution
}
```

**Invariants**:
- Deprecated patterns remain usable - warnings only
- Stale series are auto-pruned after retention period
- Resource conflicts are flagged, not auto-resolved

---

## Error Codes

All services throw `AppError` with standardized codes:

| Code | Meaning | HTTP Status |
|------|---------|-------------|
| `NOT_FOUND` | Resource doesn't exist | 404 |
| `UNAUTHORIZED` | Missing/invalid credentials | 401 |
| `FORBIDDEN` | Lacks permission | 403 |
| `CONFLICT` | State machine violation | 409 |
| `VALIDATION` | Input validation failed | 400 |
| `RATE_LIMITED` | Too many requests | 429 |
| `WEBHOOK_SIGNATURE` | Invalid webhook signature | 400 |
| `PROVIDER_NOT_CONFIGURED` | Gateway/connector not set up | 400 |

---

## Audit Trail

Every mutation appends to `ActivityLog` with:
- `action` (e.g., `invoice.created`, `subscription.cancelled`)
- `entityType` + `entityId`
- `meta` (diff snapshot for updates)
- `userId` + `ip`

**Invariants**:
- Audit entry is in SAME transaction as mutation
- Cannot delete/update ActivityLog - append-only
- ActivityLog is used for compliance/export

---

## Monitoring Points

Services expose health metrics:
- `billing.renewal_success_rate` (successful renewal / total attempts)
- `payment.settlement_latency_ms` (webhook received to invoice settled)
- `temporal.pattern_compile_errors` (failed DSL compilations)
- `audit.log_write_failures` (audit transaction failures)

These are tracked in `SystemSetting` for uptime dashboards.
