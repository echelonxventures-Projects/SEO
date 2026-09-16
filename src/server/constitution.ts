/**
 * UCOS Ω∞ Constitutional Domain Registry — §12 Registry + §18 Blueprint.
 * Machine-readable "constitution" of the platform, served at
 * GET /api/v1/registry. Adding a domain = adding a manifest here plus its
 * module; no consumer changes (consumers read the registry).
 */

export type DomainManifest = {
  id: string;
  name: string;
  version: string;
  purpose: string;
  blueprint: {
    schema: string[];
    rules: string[];
    workflows: string[];
    governance: string[];
    analytics: string[];
  };
  events: { emits: string[]; consumes: string[] };
  contracts: { api: string[]; extensions: string[] };
  status: "stable" | "building" | "planned";
};

export const CONSTITUTION = {
  system: "UCOS Ω∞ — Universal Campaign Operating System",
  implementation: "OmniMark",
  version: "1.1",
  architectureStyle: "Constitutional Domain Architecture (CDA)",
  principle: "Campaigns do not own resources. Campaigns orchestrate resources owned by domains.",
  domains: [
    {
      id: "orchestrator",
      name: "Campaign Orchestrator",
      version: "1.0",
      purpose: "Composition & execution engine. References domain resources; owns none.",
      blueprint: {
        schema: ["Campaign", "CampaignComposition", "CampaignLifecycle timestamps"],
        rules: ["references-validated-on-plan", "no-owned-entities", "launch-requires-approval", "budget-vs-spend-guardrails"],
        workflows: ["DRAFT", "PLANNED", "PENDING_APPROVAL", "APPROVED", "LIVE", "CLOSED", "LEARNED"],
        governance: ["approval by permission", "immutable lifecycle timestamps", "activity trail"],
        analytics: ["composition rollups", "simulation", "learnings snapshot"],
      },
      events: {
        emits: ["campaign.planned", "campaign.approved", "campaign.launched", "campaign.closed", "campaign.learned"],
        consumes: ["flight.*", "content.published", "offer.redeemed", "payment.*"],
      },
      contracts: {
        api: ["/api/v1/campaigns/wizard", "/api/v1/orchestrator/*"],
        extensions: ["strategy plugins", "simulation models"],
      },
      status: "building",
    },
    {
      id: "client",
      name: "Client Domain",
      version: "1.0",
      purpose: "Complete lifecycle of organizations & stakeholders.",
      blueprint: {
        schema: ["Client", "Contact", "Note", "Tag"],
        rules: ["org-isolation", "financial-trail-immuteability", "plan-seat semantics"],
        workflows: ["prospect → active → paused → archived", "lead pipeline → conversion"],
        governance: ["RBAC+ABAC grants", "audit trail", "consent tags via audience"],
        analytics: ["retention", "billed vs collected", "LTV-ready ledger"],
      },
      events: { emits: ["client.created", "client.updated"], consumes: ["invoice.*", "payment.*"] },
      contracts: { api: ["/api/v1/clients", "/api/v1/leads"], extensions: ["industry packs: healthcare, education, …"] },
      status: "stable",
    },
    {
      id: "content",
      name: "Content Domain",
      version: "1.0",
      purpose: "The complete content universe: ideation → creation → review → publish → monitor → archive.",
      blueprint: {
        schema: ["ContentPost", "ContentTarget", "BlogPost", "GenerationJob", "BrandVoice", "PromptTemplate"],
        rules: ["connection-gated publishing", "idempotent targets", "studio lineage"],
        workflows: ["draft → scheduled → publishing → published/failed → archived"],
        governance: ["brand-voice guardrails in prompts", "demo/real source labelling"],
        analytics: ["slot yield", "engagement via provider", "rank correlation"],
      },
      events: { emits: ["content.created", "content.published", "content.failed", "blog.published"], consumes: ["channel.*", "offer.*"] },
      contracts: { api: ["/api/v1/content/*", "/api/v1/studio/*", "/api/v1/blogs"], extensions: ["new content types via registry"] },
      status: "stable",
    },
    {
      id: "audience",
      name: "Audience Domain",
      version: "1.0",
      purpose: "Universal target bases: identities, consent, segments.",
      blueprint: {
        schema: ["Audience", "AudienceMember", "MailingList", "Subscriber"],
        rules: ["identity-keyed dedupe", "consent never silently overwritten", "archive-safe deletion"],
        workflows: ["create → import/sync → segment → activate → archive"],
        governance: ["per-member consent", "GDPR export via data-export"],
        analytics: ["consent breakdown", "membership counts"],
      },
      events: { emits: ["audience.created", "audience.member.imported", "audience.synced"], consumes: ["payment.*", "email.*"] },
      contracts: { api: ["/api/v1/audiences/*"], extensions: ["AI segments", "lookalikes", "identity graph"] },
      status: "stable",
    },
    {
      id: "channel",
      name: "Channel Domain",
      version: "1.0",
      purpose: "Universal communication infrastructure via registries, never code.",
      blueprint: {
        schema: ["Channel", "ConnectorTemplate", "SocialConnection", "SocialAppConfig", "GatewayConfig"],
        rules: ["org-override-beats-global", "readiness = live connection", "secrets envelope-encrypted"],
        workflows: ["register → connect → publish → monitor"],
        governance: ["token lifecycle + rotation", "provider webhooks verified"],
        analytics: ["channel spend vs revenue"],
      },
      events: { emits: ["channel.created", "social.connected"], consumes: ["content.published"] },
      contracts: { api: ["/api/v1/channels", "/api/v1/social/*", "/api/v1/sites/*"], extensions: ["any OAuth2 platform as data"] },
      status: "stable",
    },
    {
      id: "calendar",
      name: "Calendar Domain",
      version: "1.1",
      purpose: "Campaign calendar views & flights; temporal assets now owned by UTP.",
      blueprint: {
        schema: ["CampaignFlight", "consumes UTP TemporalPattern (cadence)"],
        rules: ["window validation", "overlap warnings", "slot materialization ≤60"],
        workflows: ["DRAFT → APPROVED → LIVE → ENDED / PAUSED / CANCELLED"],
        governance: ["cron-swept status only (no client writes)"],
        analytics: ["flight utilization", "slot yield"],
      },
      events: { emits: ["flight.created", "flight.approved", "flight.activated", "flight.ended", "flight.slots", "flight.cadence_adopted"], consumes: ["channel.*", "audience.*", "temporal.*"] },
      contracts: { api: ["/api/v1/flights/*", "/api/v1/calendar"], extensions: ["event-driven & predictive scheduling"] },
      status: "stable",
    },
    {
      id: "temporal",
      name: "Universal Temporal Platform",
      version: "1.0",
      purpose: "Enterprise authority for time, patterns, availability, appointments, resources, workforce, dependencies, constraints, triggers, intelligence, analytics & temporal governance. All other domains CONSUME these temporal assets.",
      blueprint: {
        schema: [
          "TimeSystem", "Calendar", "CalendarShare", "TemporalPattern", "TemporalExpression", "TemporalRange",
          "TemporalRule", "TemporalDependency", "ScheduledEvent", "EventOccurrence", "EventAttendee", "Resource",
          "ResourceBooking", "AvailabilityProfile", "BlackoutWindow", "Appointment", "AppointmentSlot", "Shift",
          "ShiftAssignment", "CoverageRequirement", "TemporalTrigger", "TemporalTriggerFire", "ExecutionPlan",
          "TemporalVersion", "TemporalEventLog", "HolidayCalendar", "Holiday", "FiscalCalendar", "LibraryTemplate",
          "TemporalConfiguration",
        ],
        rules: [
          "schedules-are-assets-not-attributes", "single-calendar-surface", "public-booking-shares-the-workspace-engine", "planetary-frame-via-sol-clock-canonical", "condition-triggers-resolve-or-reject", "share-tokens-always-revocable", "expandPattern-is-the-only-expansion-door", "event-stream-at-least-once-resumable", "dsl-compiles-to-validated-ast", "recurrence-materialized-bounded",
          "hard-constraints-block-writes", "integer-second-durations", "zone-local-wall-time", "planetary-time-via-time-systems",
          "waitlist-promotion-is-atomic", "capacity-claims-are-conditional-updates", "event-log-append-only",
        ],
        workflows: [
          "pattern: DRAFT → ACTIVE → DEPRECATED → ARCHIVED", "appointment: WAITLISTED → PENDING → CONFIRMED → CHECKED_IN → COMPLETED | CANCELLED | NO_SHOW",
          "trigger: ARMED → PAUSED → EXHAUSTED", "execution: PLANNED → RUNNING → COMPLETED | FAILED | SKIPPED",
        ],
        governance: ["TemporalEventLog (replay/time-travel)", "TemporalVersion snapshots + rollback", "retention policy sweep", "audit on every mutation"],
        analytics: ["resource utilization (merged-interval math)", "scheduling throughput", "capacity forecast", "conflict detection", "trigger success"],
      },
      events: {
        emits: [
          "calendar.*", "pattern.*", "event.*", "occurrence.*", "appointment.*", "slots.generated", "resource.*",
          "availability.*", "shift.*", "trigger.armed", "trigger.exhausted", "dependency.created", "rule.created",
          "holidays.created", "library.instantiated", "config.updated", "governance.rolled_back", "temporal.execution", "transport.created",
        ],
        consumes: ["flight.*", "invoice.*", "payment.*", "campaign.*", "content.*"],
      },
      contracts: {
        api: ["/api/v1/temporal/* (incl. /timeline, /monitor & /adopt-legacy)", "/api/v1/public/booking/*", "/api/v1/public/feed/[token] (ICS)", "/book/{token}", "/api/v1/calendars/*", "/api/v1/patterns/*", "/api/v1/appointments/*", "/api/v1/resources/*", "/api/v1/workforce/*", "/api/v1/library/*", "/api/v1/governance/*", "/api/v1/intelligence/*", "/api/v1/cron/temporal-*", "/api/v1/cron/reports"],
        extensions: ["SerpProvider-style schedule providers", "event-streaming transport (Kafka/Pulsar) behind TemporalEventLog", "richer DSL functions"],
      },
      status: "building",
    },
    {
      id: "offer",
      name: "Offer Domain",
      version: "1.0",
      purpose: "Value propositions & incentives with full lifecycle & redemption accounting.",
      blueprint: {
        schema: ["Offer", "OfferRedemption", "CampaignOffer"],
        rules: ["eligibility: window + min-spend + caps", "atomic redemption", "archive-safe"],
        workflows: ["DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED → ACTIVE → EXPIRED → ARCHIVED"],
        governance: ["approval separation", "redemption audit"],
        analytics: ["redemption rate", "discount cost"],
      },
      events: { emits: ["offer.activated", "offer.redeemed", "offer.expired"], consumes: ["invoice.created"] },
      contracts: { api: ["/api/v1/offers/*", "redeem on invoice create"], extensions: ["loyalty, referral, membership engines"] },
      status: "building",
    },
    {
      id: "analytics",
      name: "Analytics Domain",
      version: "1.0",
      purpose: "System-wide intelligence: monitoring, forecasting, anomaly detection.",
      blueprint: {
        schema: ["CampaignMetric", "RankSnapshot", "Report (consumes UTP TemporalPattern; cron-run)", "ReportRun", "DomainEvent"],
        rules: ["derived metrics only, never client-set"],
        workflows: ["collect → aggregate → report → alert"],
        governance: ["activity read scoping"],
        analytics: ["ROI/ROAS/CTR", "retention", "forecasting (roadmap)"],
      },
      events: { emits: ["report.ran", "report.created", "report.pattern_adopted"], consumes: ["*"] },
      contracts: { api: ["/api/v1/analytics/*", "/api/v1/reports/*", "/api/v1/events"], extensions: ["vector/knowledge layers"] },
      status: "stable",
    },
    {
      id: "governance",
      name: "Governance Layer",
      version: "1.0",
      purpose: "Cross-domain: identity, policy, audit, compliance.",
      blueprint: {
        schema: ["ActivityLog", "IdempotencyRecord", "WebhookEvent", "SystemSetting"],
        rules: ["fail-fast env", "RBAC+plan gates", "maintenance mode"],
        workflows: ["authn → CSRF/origin → rate → permission → service → audit"],
        governance: ["immutable trails", "crypto keyring rotation"],
        analytics: ["readiness score", "health"],
      },
      events: { emits: ["platform.maintenance", "auth.*"], consumes: ["*"] },
      contracts: { api: ["/api/v1/health", "/api/v1/settings/readiness", "/api/v1/registry"], extensions: ["policy engine, compliance packs"] },
      status: "stable",
    },
    {
      id: "factory",
      name: "Future Domain Factory",
      version: "0.1",
      purpose: "Create entirely new domains without platform redesign.",
      blueprint: {
        schema: ["DomainManifest (this file)", "PluggableRegistry (connectors/channels/templates/pixel templates)"],
        rules: ["new domain = manifest + module + routes + UI"],
        workflows: ["design → register → operate"],
        governance: ["same constitutional blueprint required"],
        analytics: ["adoption per domain"],
      },
      events: { emits: [], consumes: ["*"] },
      contracts: { api: ["/api/v1/registry"], extensions: ["schema designers, workflow designers (roadmap)"] },
      status: "planned",
    },
  ] as DomainManifest[],
};

export function findDomain(id: string) {
  return CONSTITUTION.domains.find((d) => d.id === id) ?? null;
}
