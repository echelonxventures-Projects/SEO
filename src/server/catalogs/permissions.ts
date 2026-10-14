export type PermissionDef = {
  code: string;
  module: string;
  action: string;
  name: string;
  description: string;
};

const MODULE_LABELS: Record<string, string> = {
  org: "Organization",
  member: "Team members",
  apikey: "API keys",
  settings: "Settings",
  client: "Clients",
  lead: "Leads",
  project: "Projects",
  task: "Tasks",
  time: "Timesheets",
  expense: "Expenses",
  catalog: "Service catalog",
  quote: "Quotes",
  invoice: "Invoices",
  payment: "Payments",
  subscription: "Subscription",
  seo: "SEO",
  campaign: "Campaigns",
  report: "Reports",
  activity: "Activity log",
  social: "Social channels",
  content: "Content calendar",
  email: "Email marketing",
  link: "Tracked links",
  site: "Sites & pixels",
  temporal: "Temporal platform",
  appointment: "Appointments",
  resource: "Resources",
  workforce: "Workforce",
};

function perm(module: string, action: string, name: string, description = ""): PermissionDef {
  return { code: `${module}.${action}`, module, action, name, description };
}

/**
 * Permission catalog — the single authoritative list. Seeded into the
 * database; runtime authorization reads grants from the DB, so the effective
 * matrix stays data (auditable, adjustable), while this catalog keeps it
 * type-safe and complete.
 */
export const PERMISSIONS: PermissionDef[] = [
  perm("org", "read", "View organization"),
  perm("org", "update", "Update organization profile"),
  perm("member", "read", "View team members"),
  perm("member", "invite", "Invite team members"),
  perm("member", "update_role", "Change member roles"),
  perm("member", "remove", "Remove team members"),
  perm("apikey", "read", "View API keys"),
  perm("apikey", "manage", "Create/revoke API keys"),
  perm("settings", "read", "View configuration (tax, numbering, catalogs)"),
  perm("settings", "manage", "Edit configuration"),
  perm("client", "read", "View clients"),
  perm("client", "write", "Create/edit clients"),
  perm("client", "delete", "Delete clients"),
  perm("lead", "read", "View leads"),
  perm("lead", "write", "Create/edit leads"),
  perm("lead", "delete", "Delete leads"),
  perm("lead", "convert", "Convert lead to client"),
  perm("project", "read", "View projects"),
  perm("project", "write", "Create/edit projects"),
  perm("project", "delete", "Delete projects"),
  perm("task", "read", "View tasks"),
  perm("task", "write", "Create/edit tasks"),
  perm("task", "delete", "Delete tasks"),
  perm("time", "read", "View timesheets"),
  perm("time", "write", "Log/edit time"),
  perm("time", "delete", "Delete time entries"),
  perm("expense", "read", "View expenses"),
  perm("expense", "write", "Add/edit expenses"),
  perm("expense", "delete", "Delete expenses"),
  perm("catalog", "read", "View service catalog"),
  perm("catalog", "write", "Manage service catalog"),
  perm("quote", "read", "View quotes"),
  perm("quote", "write", "Create/edit quotes"),
  perm("quote", "delete", "Delete quotes"),
  perm("quote", "approve", "Approve/decline quotes"),
  perm("quote", "convert", "Convert quote to invoice"),
  perm("invoice", "read", "View invoices"),
  perm("invoice", "write", "Create/edit invoices"),
  perm("invoice", "delete", "Delete draft invoices"),
  perm("invoice", "issue", "Issue/send invoices"),
  perm("invoice", "void", "Void invoices"),
  perm("invoice", "collect", "Generate payment collection links"),
  perm("payment", "read", "View payments"),
  perm("payment", "write", "Record payments"),
  perm("payment", "refund", "Refund payments"),
  perm("subscription", "read", "View subscription & billing"),
  perm("subscription", "manage", "Change plan, cancel, update payment method"),
  perm("seo", "read", "View keywords, rankings, backlinks, audits"),
  perm("seo", "write", "Manage SEO entities and run audits"),
  perm("campaign", "read", "View campaigns"),
  perm("campaign", "write", "Create/edit campaigns and metrics"),
  perm("campaign", "approve", "Approve a planned campaign for launch (separation of duty)"),
  perm("report", "read", "View reports"),
  perm("report", "write", "Create/edit reports"),
  perm("report", "delete", "Delete reports"),
  perm("activity", "read", "View the audit trail"),
  perm("social", "read", "View social accounts"),
  perm("social", "connect", "Connect/disconnect social accounts"),
  perm("social", "configure", "Manage social app credentials"),
  perm("content", "read", "View content calendar"),
  perm("content", "write", "Create/edit/schedule content"),
  perm("content", "publish", "Publish or retry posts"),
  perm("email", "read", "View email marketing"),
  perm("email", "write", "Manage lists, subscribers and campaigns"),
  perm("email", "send", "Send/test email campaigns"),
  perm("link", "read", "View tracked links"),
  perm("link", "write", "Create/edit tracked links"),
  perm("site", "read", "View web properties and pixels"),
  perm("site", "write", "Manage web properties and pixels"),
  perm("temporal", "read", "View calendars, patterns, occurrences & governance"),
  perm("temporal", "write", "Manage calendars, temporal patterns, events & triggers"),
  perm("temporal", "manage", "Platform temporal library, time systems & rollback"),
  perm("appointment", "read", "View appointments & slots"),
  perm("appointment", "book", "Book, reschedule and cancel appointments"),
  perm("appointment", "manage", "Generate slots, promote waitlist, check-in"),
  perm("resource", "read", "View resources & bookings"),
  perm("resource", "write", "Manage resources, bookings & availability"),
  perm("workforce", "read", "View shifts, rotations & coverage"),
  perm("workforce", "write", "Manage shifts, assignments & coverage rules"),
];

export const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

export type RoleTemplate = {
  code: string;
  name: string;
  rank: number;
  description: string;
  grants: "*" | string[]; // entries support trailing ".*" wildcards
};

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    code: "OWNER",
    name: "Owner",
    rank: 100,
    description: "Full control of the organization, billing and team.",
    grants: "*",
  },
  {
    code: "ADMIN",
    name: "Admin",
    rank: 90,
    description: "Full operational control including configuration and security settings.",
    grants: "*",
  },
  {
    code: "MANAGER",
    name: "Manager",
    rank: 70,
    description:
      "Runs sales and delivery end-to-end. No access to platform settings, API keys or destructive configuration.",
    grants: [
      "org.read",
      "member.read",
      "member.invite",
      "settings.read",
      "client.*",
      "lead.*",
      "project.read",
      "project.write",
      "task.*",
      "time.*",
      "expense.*",
      "catalog.*",
      "quote.*",
      "invoice.read",
      "invoice.write",
      "invoice.issue",
      "invoice.send",
      "invoice.collect",
      "payment.*",
      "subscription.read",
      "subscription.manage",
      "seo.*",
      "campaign.read",
      "campaign.write",
      "report.*",
      "activity.read",
      "social.read",
      "social.connect",
      "content.*",
      "email.*",
      "link.*",
      "site.*",
      "temporal.*",
      "appointment.*",
      "resource.*",
      "workforce.*",
    ],
  },
  {
    code: "MEMBER",
    name: "Member",
    rank: 40,
    description: "Delivery contributor: works tasks, logs time, maintains SEO and campaigns.",
    grants: [
      "org.read",
      "member.read",
      "settings.read",
      "client.read",
      "lead.read",
      "lead.write",
      "project.read",
      "project.write",
      "task.*",
      "time.*",
      "expense.*",
      "catalog.read",
      "quote.read",
      "invoice.read",
      "payment.read",
      "subscription.read",
      "seo.*",
      "campaign.read",
      "campaign.write",
      "report.read",
      "report.write",
      "social.read",
      "social.connect",
      "content.*",
      "email.read",
      "email.write",
      "email.send",
      "link.*",
      "site.*",
      "temporal.read",
      "temporal.write",
      "appointment.*",
      "resource.*",
      "workforce.*",
    ],
  },
  {
    code: "VIEWER",
    name: "Viewer",
    rank: 10,
    description: "Read-only access for stakeholders and client-facing staff.",
    grants: ["*.read"],
  },
];

export function expandGrants(grants: "*" | string[], catalog: string[]): string[] {
  if (grants === "*") return [...catalog];
  const out = new Set<string>();
  for (const pattern of grants) {
    if (pattern === "*") {
      catalog.forEach((c) => out.add(c));
      continue;
    }
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -1);
      catalog.filter((c) => c.startsWith(prefix)).forEach((c) => out.add(c));
      continue;
    }
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      catalog.filter((c) => c.endsWith(suffix)).forEach((c) => out.add(c));
      continue;
    }
    out.add(pattern);
  }
  return [...out];
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}
