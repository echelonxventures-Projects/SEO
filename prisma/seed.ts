/**
 * OmniMark seed — global reference data + permission catalog + billing plans
 * + a fully populated demo workspace.
 *
 * Idempotent: safe to re-run. Business dictionaries live here so that the rest
 * of the app contains ZERO hardcoded business values (everything is DB-driven).
 *
 * Demo credentials are printed at the end; the password is configurable via
 * DEMO_PASSWORD env so real deployments can rotate it.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { FeatureCode, PlanInterval, UnitType } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/crypto";
import {
  PERMISSIONS,
  ROLE_TEMPLATES,
  expandGrants,
  ALL_PERMISSION_CODES,
} from "../src/server/catalogs/permissions";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  // -------------------------------------------------------------------------
  // 1. Currencies
  // -------------------------------------------------------------------------
  const CURRENCIES = [
    { code: "INR", name: "Indian Rupee", symbol: "₹", minorUnits: 2 },
    { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
    { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
    { code: "GBP", name: "British Pound", symbol: "£", minorUnits: 2 },
    { code: "AED", name: "UAE Dirham", symbol: "د.إ", minorUnits: 2 },
    { code: "SGD", name: "Singapore Dollar", symbol: "S$", minorUnits: 2 },
  ];
  for (const c of CURRENCIES) {
    await db.currency.upsert({ where: { code: c.code }, create: c, update: c });
  }

  // -------------------------------------------------------------------------
  // 2. Global categories (orgs can add their own org-scoped ones too)
  // -------------------------------------------------------------------------
  const GLOBAL_CATEGORIES: Array<{ kind: "CAMPAIGN_CHANNEL" | "SERVICE" | "INDUSTRY" | "LEAD_SOURCE" | "EXPENSE_TYPE" | "PROJECT_TYPE"; code: string; name: string; sortOrder: number }> = [
    { kind: "CAMPAIGN_CHANNEL", code: "GOOGLE_ADS", name: "Google Ads", sortOrder: 1 },
    { kind: "CAMPAIGN_CHANNEL", code: "META_ADS", name: "Meta (Facebook/Instagram)", sortOrder: 2 },
    { kind: "CAMPAIGN_CHANNEL", code: "LINKEDIN_ADS", name: "LinkedIn Ads", sortOrder: 3 },
    { kind: "CAMPAIGN_CHANNEL", code: "YOUTUBE", name: "YouTube", sortOrder: 4 },
    { kind: "CAMPAIGN_CHANNEL", code: "ORGANIC_SEO", name: "Organic Search", sortOrder: 5 },
    { kind: "CAMPAIGN_CHANNEL", code: "EMAIL", name: "Email", sortOrder: 6 },
    { kind: "SERVICE", code: "SEO", name: "SEO", sortOrder: 1 },
    { kind: "SERVICE", code: "PPC", name: "Paid Advertising (PPC)", sortOrder: 2 },
    { kind: "SERVICE", code: "SOCIAL", name: "Social Media Marketing", sortOrder: 3 },
    { kind: "SERVICE", code: "CONTENT", name: "Content Marketing", sortOrder: 4 },
    { kind: "SERVICE", code: "WEB", name: "Web Development", sortOrder: 5 },
    { kind: "SERVICE", code: "BRANDING", name: "Branding & Design", sortOrder: 6 },
    { kind: "INDUSTRY", code: "SAAS", name: "SaaS", sortOrder: 1 },
    { kind: "INDUSTRY", code: "ECOM", name: "E-commerce", sortOrder: 2 },
    { kind: "INDUSTRY", code: "LOCAL", name: "Local Business", sortOrder: 3 },
    { kind: "INDUSTRY", code: "EDU", name: "Education", sortOrder: 4 },
    { kind: "INDUSTRY", code: "HEALTH", name: "Healthcare", sortOrder: 5 },
    { kind: "INDUSTRY", code: "FINTECH", name: "Fintech", sortOrder: 6 },
    { kind: "LEAD_SOURCE", code: "REFERRAL", name: "Referral", sortOrder: 1 },
    { kind: "LEAD_SOURCE", code: "WEBSITE", name: "Website Enquiry", sortOrder: 2 },
    { kind: "LEAD_SOURCE", code: "SOCIAL", name: "Social Media", sortOrder: 3 },
    { kind: "LEAD_SOURCE", code: "OUTREACH", name: "Cold Outreach", sortOrder: 4 },
    { kind: "LEAD_SOURCE", code: "MARKETPLACE", name: "Freelance Marketplace", sortOrder: 5 },
    { kind: "EXPENSE_TYPE", code: "SOFTWARE", name: "Software / Subscriptions", sortOrder: 1 },
    { kind: "EXPENSE_TYPE", code: "AD_SPEND", name: "Ad Spend", sortOrder: 2 },
    { kind: "EXPENSE_TYPE", code: "CONTRACTOR", name: "Contractor / Freelancer", sortOrder: 3 },
    { kind: "EXPENSE_TYPE", code: "TRAVEL", name: "Travel", sortOrder: 4 },
    { kind: "EXPENSE_TYPE", code: "OTHER", name: "Other", sortOrder: 5 },
  ];
  for (const cat of GLOBAL_CATEGORIES) {
    const existing = await db.category.findFirst({ where: { orgId: null, kind: cat.kind, code: cat.code } });
    if (existing) {
      await db.category.update({ where: { id: existing.id }, data: { name: cat.name, sortOrder: cat.sortOrder, active: true } });
    } else {
      await db.category.create({ data: { orgId: null, ...cat } });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Default tax rates (global). GST INTRA/INTER with CGST/SGST/IGST children.
  // -------------------------------------------------------------------------
  const GST_RATES = [
    { code: "GST_5", name: "GST 5%", bps: 500 },
    { code: "GST_12", name: "GST 12%", bps: 1200 },
    { code: "GST_18", name: "GST 18%", bps: 1800 },
    { code: "GST_28", name: "GST 28%", bps: 2800 },
  ];
  for (const g of GST_RATES) {
    await upsertTaxRate({ code: `${g.code}_INTRA`, name: `${g.name} (Intra-state)`, kind: "GST_INTRA", rateBps: g.bps });
    await upsertTaxRate({ code: `${g.code}_INTER`, name: `${g.name} (Inter-state)`, kind: "GST_INTER", rateBps: g.bps });
  }
  async function upsertTaxRate(t: { code: string; name: string; kind: "GST_INTRA" | "GST_INTER"; rateBps: number }) {
    let parent = await db.taxRate.findFirst({ where: { orgId: null, code: t.code } });
    if (parent) {
      parent = await db.taxRate.update({
        where: { id: parent.id },
        data: { name: t.name, kind: t.kind, rateBps: t.rateBps, active: true },
      });
    } else {
      parent = await db.taxRate.create({
        data: { orgId: null, code: t.code, name: t.name, kind: t.kind, rateBps: t.rateBps, gstCategory: "SAC 9983", active: true },
      });
    }
    const parts =
      t.kind === "GST_INTRA"
        ? [
            { label: "CGST", bps: Math.floor(t.rateBps / 2) },
            { label: "SGST", bps: t.rateBps - Math.floor(t.rateBps / 2) },
          ]
        : [{ label: "IGST", bps: t.rateBps }];
    for (const part of parts) {
      const compCode = `${t.code}-${part.label}`;
      const compName = `${part.label} ${t.rateBps / 100}% on ${t.name.replace(/ \(.*\)$/, "")}`;
      const comp = await db.taxRate.findFirst({ where: { orgId: null, code: compCode } });
      if (comp) {
        await db.taxRate.update({
          where: { id: comp.id },
          data: { rateBps: part.bps, parentGroupTaxRateId: parent.id, active: true, name: compName },
        });
      } else {
        await db.taxRate.create({
          data: {
            orgId: null,
            code: compCode,
            name: compName,
            kind: "FLAT",
            rateBps: part.bps,
            gstCategory: "SAC 9983",
            parentGroupTaxRateId: parent.id,
            active: true,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Geo locations (global, for rank tracking)
  // -------------------------------------------------------------------------
  const GEOS = [
    { name: "India", googleId: "IN", countryCode: "IN" },
    { name: "Mumbai, Maharashtra, India", googleId: "IN-22", countryCode: "IN" },
    { name: "Delhi, India", googleId: "IN-07", countryCode: "IN" },
    { name: "Bengaluru, Karnataka, India", googleId: "IN-29", countryCode: "IN" },
    { name: "United States", googleId: "US", countryCode: "US" },
    { name: "United Kingdom", googleId: "GB", countryCode: "GB" },
    { name: "United Arab Emirates", googleId: "AE", countryCode: "AE" },
    { name: "Singapore", googleId: "SG", countryCode: "SG" },
  ];
  for (const g of GEOS) {
    const geo = await db.geoLocation.findFirst({ where: { orgId: null, name: g.name } });
    if (geo) {
      await db.geoLocation.update({ where: { id: geo.id }, data: { googleId: g.googleId, countryCode: g.countryCode, active: true } });
    } else {
      await db.geoLocation.create({ data: { orgId: null, ...g, active: true } });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Permissions + roles + grants (RBAC catalog)
  // -------------------------------------------------------------------------
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { module: p.module, action: p.action, name: p.name, description: p.description },
    });
  }
  for (const role of ROLE_TEMPLATES) {
    const saved = await db.role.upsert({
      where: { code: role.code },
      create: { code: role.code, name: role.name, description: role.description, rank: role.rank, isSystem: true },
      update: { name: role.name, description: role.description, rank: role.rank, isSystem: true },
    });
    const grants = expandGrants(role.grants, ALL_PERMISSION_CODES);
    const perms = await db.permission.findMany({ where: { code: { in: grants } } });
    await db.rolePermission.deleteMany({ where: { roleId: saved.id } });
    if (perms.length) {
      await db.rolePermission.createMany({
        data: perms.map((perm) => ({ roleId: saved.id, permissionId: perm.id })),
        skipDuplicates: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Billing plans (global). Prices in paise.
  // -------------------------------------------------------------------------
  const plans: Array<{
    code: string;
    name: string;
    description: string;
    priceMinor: bigint;
    interval: PlanInterval;
    trialDays: number;
    maxSeats: number;
    maxClients: number;
    maxProjects: number;
    maxKeywords: number;
    sortOrder: number;
    features: FeatureCode[];
  }> = [
    {
      code: "STARTER",
      name: "Starter",
      description: "Solo marketers: CRM, quotes, invoices, SEO rank tracking.",
      priceMinor: 99000n,
      interval: "MONTH",
      trialDays: 14,
      maxSeats: 2,
      maxClients: 15,
      maxProjects: 25,
      maxKeywords: 100,
      sortOrder: 1,
      features: ["RANK_TRACKING", "SITE_AUDIT", "QUOTES", "INVOICING", "REPORT_BUILDER", "TIME_TRACKING"] as FeatureCode[],
    },
    {
      code: "GROWTH",
      name: "Growth",
      description: "Small teams: campaigns, expenses, backlinks, online collection.",
      priceMinor: 249000n,
      interval: "MONTH",
      trialDays: 14,
      maxSeats: 10,
      maxClients: 100,
      maxProjects: 150,
      maxKeywords: 1000,
      sortOrder: 2,
      features: [
        "RANK_TRACKING", "SITE_AUDIT", "BACKLINK_INDEX", "CAMPAIGN_METRICS", "TIME_TRACKING",
        "EXPENSE_TRACKING", "QUOTES", "INVOICING", "ONLINE_COLLECT", "REPORT_BUILDER", "AI_PREMIUM",
      ] as FeatureCode[],
    },
    {
      code: "AGENCY",
      name: "Agency",
      description: "Agencies at scale: white-label invoices and full API access.",
      priceMinor: 599000n,
      interval: "MONTH",
      trialDays: 14,
      maxSeats: 50,
      maxClients: 0,
      maxProjects: 0,
      maxKeywords: 10000,
      sortOrder: 3,
      features: [
        "RANK_TRACKING", "SITE_AUDIT", "BACKLINK_INDEX", "CAMPAIGN_METRICS", "TIME_TRACKING",
        "EXPENSE_TRACKING", "QUOTES", "INVOICING", "ONLINE_COLLECT", "REPORT_BUILDER",
        "API_ACCESS", "WHITE_LABEL", "AI_PREMIUM",
      ],
    },
    {
      code: "ANNUAL_GROWTH",
      name: "Growth (Annual)",
      description: "Growth billed yearly — two months free.",
      priceMinor: 2490000n,
      interval: "YEAR",
      trialDays: 14,
      maxSeats: 10,
      maxClients: 100,
      maxProjects: 150,
      maxKeywords: 1000,
      sortOrder: 4,
      features: [
        "RANK_TRACKING", "SITE_AUDIT", "BACKLINK_INDEX", "CAMPAIGN_METRICS", "TIME_TRACKING",
        "EXPENSE_TRACKING", "QUOTES", "INVOICING", "ONLINE_COLLECT", "REPORT_BUILDER", "AI_PREMIUM",
      ] as FeatureCode[],
    },
  ];
  for (const plan of plans) {
    const saved = await db.plan.upsert({
      where: { code: plan.code },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMinor: plan.priceMinor,
        currencyCode: "INR",
        interval: plan.interval,
        trialDays: plan.trialDays,
        maxSeats: plan.maxSeats,
        maxClients: plan.maxClients,
        maxProjects: plan.maxProjects,
        maxKeywords: plan.maxKeywords,
        status: "PUBLISHED",
        sortOrder: plan.sortOrder,
      },
      update: {
        name: plan.name,
        description: plan.description,
        priceMinor: plan.priceMinor,
        interval: plan.interval,
        trialDays: plan.trialDays,
        maxSeats: plan.maxSeats,
        maxClients: plan.maxClients,
        maxProjects: plan.maxProjects,
        maxKeywords: plan.maxKeywords,
        status: "PUBLISHED",
        sortOrder: plan.sortOrder,
      },
    });
    await db.planFeature.deleteMany({ where: { planId: saved.id } });
    await db.planFeature.createMany({
      data: plan.features.map((featureCode) => ({ planId: saved.id, featureCode: featureCode as never })),
      skipDuplicates: true,
    });
  }

  // -------------------------------------------------------------------------
  // 7. Default demo user + workspace with rich sample data.
  // -------------------------------------------------------------------------
  const demoPassword = process.env.DEMO_PASSWORD || "DemoPassword#1";
  const demoEmail = (process.env.DEMO_EMAIL || "founder@aithink.india").toLowerCase();
  const demoHash = await hashPassword(demoPassword);

  const owner = await db.user.upsert({
    where: { emailNormalized: demoEmail },
    create: {
      email: demoEmail,
      emailNormalized: demoEmail,
      name: "Demo Founder",
      passwordHash: demoHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      isPlatformAdmin: true,
    },
    update: { isPlatformAdmin: true },
  });

  const ownerRole = await db.role.findUniqueOrThrow({ where: { code: "OWNER" } });

  const { bootstrapOrganization } = await import("../src/server/services/org-defaults");
  let org = await db.organization.findFirst({ where: { name: "AIthink Digital" } });
  if (!org) {
    org = await db.organization.create({
      data: {
        name: "AIthink Digital",
        slug: "aithink-digital",
        status: "ACTIVE",
        defaultCurrencyCode: "INR",
        country: "IN",
        state: "Maharashtra",
        city: "Mumbai",
        timezone: "Asia/Kolkata",
        locale: "en-IN",
        gstin: "27AAECE1234F1Z5",
        email: demoEmail,
        billingEmail: demoEmail,
        phone: "+91 98765 43210",
        website: "https://aithink.india",
      },
    });
    await db.$transaction(async (tx) => {
      await bootstrapOrganization(tx, org!);
    });
  }
  await db.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: owner.id } },
    create: { orgId: org.id, userId: owner.id, roleId: ownerRole.id },
    update: { roleId: ownerRole.id, status: "ACTIVE" },
  });

  const growthPlan = await db.plan.findUniqueOrThrow({ where: { code: "GROWTH" } });
  const existingSub = await db.subscription.findFirst({ where: { orgId: org.id } });
  if (!existingSub) {
    const now = new Date();
    const sub = await db.subscription.create({
      data: {
        orgId: org.id,
        planId: growthPlan.id,
        status: "ACTIVE",
        seats: 5,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400_000),
      },
    });
    const cycle = await db.billingCycle.create({
      data: {
        subscriptionId: sub.id,
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * 86400_000),
        status: "INVOICED",
      },
    });
    const inv = await db.invoice.create({
      data: {
        orgId: org.id,
        tenantId: org.id,
        partyKind: "TENANT",
        subscriptionId: sub.id,
        number: "OMNI-SUB-0001",
        status: "SENT",
        currencyCode: "INR",
        issueDate: now,
        dueDate: new Date(now.getTime() + 7 * 86400_000),
        subtotalMinor: growthPlan.priceMinor,
        taxMinor: 0n,
        totalMinor: growthPlan.priceMinor,
        taxBreakdown: [],
        notes: "OmniMark Growth — first cycle",
        createdByUserId: owner.id,
        lines: {
          create: [
            {
              description: `OmniMark subscription — ${growthPlan.name} (monthly cycle)`,
              qtyHundredths: 100,
              unitPriceMinor: growthPlan.priceMinor,
              taxBps: 0,
              lineTotalMinor: growthPlan.priceMinor,
              sourceType: "SUBSCRIPTION",
              sortOrder: 0,
            },
          ],
        },
      },
    });
    await db.billingCycle.update({ where: { id: cycle.id }, data: { invoiceId: inv.id } });
  }

  const { seedPlaceholders } = await import("./seed-placeholders");
  await seedPlaceholders();

  const { seedTemporalGlobals } = await import("./seed-temporal");
  await seedTemporalGlobals();

  const demoAllowed = process.env.NODE_ENV !== "production" || process.env.DEMO_SEED_OVERRIDE === "1";
  if (!demoAllowed) {
    console.log("  [prod mode] demo workspace skipped — reference data only.");
  }
  if (demoAllowed) {
    await seedDemoWorkspace(org.id, owner.id);
    const { seedMarketing } = await import("./seed-marketing");
    const ids = Object.fromEntries(
      await db.client.findMany({ where: { orgId: org.id } }).then((cs) => {
        const key = (n: string) => n.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
        return cs.map((c) => [key(c.name), c.id] as [string, string]);
      }),
    );
    await seedMarketing(org.id, owner.id, ids);
    const { seedCampaignSystems } = await import("./seed-campaign-systems");
    await seedCampaignSystems(org.id, owner.id);
    const { seedTemporalWorkspace } = await import("./seed-temporal");
    await seedTemporalWorkspace(org.id, owner.id);
  }

  console.log("\n==================== OmniMark seeded ====================");
  console.log(`  Login email   : ${demoEmail}`);
  console.log(`  Login password: ${process.env.DEMO_PASSWORD ? "(from DEMO_PASSWORD env)" : demoPassword}`);
  console.log(`  Workspace     : ${org.name} (${org.slug})`);
  console.log("  Plans         : STARTER, GROWTH, AGENCY, ANNUAL_GROWTH");
  console.log("  Roles         : OWNER, ADMIN, MANAGER, MEMBER, VIEWER");
  console.log("=========================================================\n");
}

async function seedDemoWorkspace(orgId: string, userId: string) {
  const growthPlan = await db.plan.findUniqueOrThrow({ where: { code: "GROWTH" } });
  void growthPlan;
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });

  // Demo service catalog (org-scoped, with INR prices + GST 18% default)
  const gst18 = await db.taxRate.findFirst({ where: { orgId: null, code: "GST_18_INTRA" } });
  const services: Array<{ code: string; name: string; unit: UnitType; price: bigint; category: string }> = [
    { code: "SEO-AUDIT", name: "Technical SEO Audit", unit: "PROJECT", price: 14900n, category: "SEO" },
    { code: "SEO-RETAINER", name: "SEO Retainer (Monthly)", unit: "MONTH", price: 49900n, category: "SEO" },
    { code: "ADS-SETUP", name: "Google Ads Campaign Setup", unit: "PROJECT", price: 25000n, category: "PPC" },
    { code: "CONTENT-PKG", name: "10 SEO Blog Posts", unit: "PROJECT", price: 39900n, category: "CONTENT" },
    { code: "SOCIAL-MGMT", name: "Social Media Management", unit: "MONTH", price: 29900n, category: "SOCIAL" },
  ];
  const catByCode = new Map(
    (await db.category.findMany({ where: { kind: "SERVICE", orgId: null } })).map((c) => [c.code, c.id]),
  );
  const svcIds: Record<string, string> = {};
  for (const s of services) {
    const saved = await db.serviceItem.upsert({
      where: { orgId_code: { orgId, code: s.code } },
      create: {
        orgId,
        code: s.code,
        name: s.name,
        unit: s.unit,
        priceMinor: s.price,
        currencyCode: org.defaultCurrencyCode,
        taxable: true,
        taxRateId: gst18?.id ?? null,
        categoryId: catByCode.get(s.category) ?? null,
        active: true,
      },
      update: { priceMinor: s.price, taxRateId: gst18?.id ?? null, active: true },
    });
    svcIds[s.code] = saved.id;
  }

  const clients = [
    { key: "lumen", name: "Lumen SaaS", industry: "SAAS", website: "https://lumen.example" } as const,
    { key: "verda", name: "Verda Organics", industry: "ECOM", website: "https://verda.example" },
    { key: "clinic", name: "BrightSmile Clinics", industry: "HEALTH", website: "https://brightsmile.example" },
  ];
  const clientIds: Record<string, string> = {};
  for (const c of clients) {
    const industry = await db.category.findFirst({ where: { kind: "INDUSTRY", code: c.industry, orgId: null } });
    const saved = await db.client.upsert({
      where: { orgId_name: { orgId, name: c.name } },
      create: {
        orgId,
        name: c.name,
        status: "ACTIVE",
        industryId: industry?.id ?? null,
        website: c.website,
        billingEmail: `accounts@${c.key}.example`,
        currencyCode: org.defaultCurrencyCode,
        paymentTermsDays: 15,
        country: "IN",
        state: "Maharashtra",
        ownerId: userId,
      },
      update: { ownerId: userId },
    });
    clientIds[c.key] = saved.id;
    const existingContact = await db.contact.findFirst({ where: { clientId: saved.id, email: `accounts@${c.key}.example` } });
    if (!existingContact) {
      await db.contact.create({
        data: { clientId: saved.id, name: `${c.name} Accounts`, email: `accounts@${c.key}.example`, isPrimary: true },
      });
    }
  }

  const projType = await db.category.findFirst({ where: { kind: "PROJECT_TYPE", code: "SEO", orgId: null } });
  const projectSpecs = [
    { key: "p-lumen", clientId: clientIds.lumen, name: "Lumen SEO Growth", hours: 25, retainer: 49900n },
    { key: "p-verda", clientId: clientIds.verda, name: "Verda Google Ads + SEO", hours: 18, retainer: 29900n },
    { key: "p-clinic", clientId: clientIds.clinic, name: "BrightSmile Local SEO", hours: 12, retainer: 24900n },
  ];
  const projIds: Record<string, string> = {};
  for (const p of projectSpecs) {
    const saved = await db.project.findFirst({ where: { orgId, name: p.name } });
    let pid: string;
    if (saved) {
      pid = saved.id;
    } else {
      const created = await db.project.create({
        data: {
          orgId,
          clientId: p.clientId,
          name: p.name,
          status: "ACTIVE",
          typeId: projType?.id ?? null,
          ownerId: userId,
          startDate: new Date(Date.now() - 45 * 86400_000),
          budgetMinor: p.retainer * 3n,
          currencyCode: org.defaultCurrencyCode,
          hourlyRateMinor: 200000n,
          domainUrl: `https://${(await db.client.findUniqueOrThrow({ where: { id: p.clientId } })).name
            .toLowerCase()
            .replace(/[^a-z]+/g, "")
            .slice(0, 20)}.example`,
        },
      });
      pid = created.id;
    }
    projIds[p.key] = pid;
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: pid, userId } },
      create: { projectId: pid, userId },
      update: {},
    });
  }

  const seedKeywords = [
    { term: "best crm software", projectId: projIds["p-lumen"] },
    { term: "saas analytics platform", projectId: projIds["p-lumen"] },
    { term: "organic skincare online", projectId: projIds["p-verda"] },
    { term: "eco friendly cleaning products", projectId: projIds["p-verda"] },
    { term: "dentist near me mumbai", projectId: projIds["p-clinic"] },
    { term: "teeth whitening cost mumbai", projectId: projIds["p-clinic"] },
  ];
  for (const k of seedKeywords) {
    const normal = k.term.toLowerCase().trim();
    const kw = await db.keyword.findFirst({ where: { orgId, normalized: normal, device: "DESKTOP" } });
    const created =
      kw ??
      (await db.keyword.create({
        data: { orgId, term: k.term, normalized: normal, device: "DESKTOP" },
      }));
    if (k.projectId) {
      await db.projectKeyword.upsert({
        where: { projectId_keywordId: { projectId: k.projectId, keywordId: created.id } },
        create: { projectId: k.projectId, keywordId: created.id },
        update: {},
      });
    }
    const seed = Math.abs(hashStr(normal));
    for (let week = 6; week >= 0; week--) {
      const capturedOn = new Date(Date.now() - week * 7 * 86400_000);
      capturedOn.setUTCHours(0, 0, 0, 0);
      const start = 24 + (seed % 12);
      const position = Math.max(3, start - Math.round((6 - week) * (1.2 + (seed % 5) / 5)));
      await db.rankSnapshot.upsert({
        where: { keywordId_capturedOn: { keywordId: created.id, capturedOn } },
        create: { orgId, keywordId: created.id, capturedOn, position, source: "DEMO" },
        update: { position, source: "DEMO" },
      });
    }
  }

  for (const b of [
    { source: "https://techcrunch.example", target: "https://lumen.example", da: 92 },
    { source: "https://producthunt.example", target: "https://lumen.example", da: 88 },
    { source: "https://skincare-journal.example", target: "https://verda.example", da: 61 },
    { source: "https://local-directory.example", target: "https://brightsmile.example", da: 35 },
  ]) {
    await db.backlink.upsert({
      where: { orgId_sourceUrl_targetUrl: { orgId, sourceUrl: b.source, targetUrl: b.target } },
      create: {
        orgId,
        sourceUrl: b.source,
        targetUrl: b.target,
        domainAuthority: b.da,
        dofollow: true,
        status: "LIVE",
      },
      update: { domainAuthority: b.da, status: "LIVE" },
    });
  }

  for (const sp of projectSpecs) {
    const pid = projIds[sp.key];
    const already = await db.timeEntry.count({ where: { projectId: pid } });
    if (already > 0) continue;
    for (let d = 12; d >= 1; d--) {
      const date = new Date(Date.now() - d * 3 * 86400_000);
      date.setUTCHours(0, 0, 0, 0);
      await db.timeEntry.create({
        data: {
          orgId,
          projectId: pid,
          userId,
          date,
          minutes: 60 + ((d * 37) % 180),
          billable: true,
          description: d % 3 === 0 ? "Content & on-page" : "Technical & reporting",
        },
      });
    }
    if (sp.key === "p-verda") {
      const adSpend = await db.category.findFirst({ where: { kind: "EXPENSE_TYPE", code: "AD_SPEND", orgId: null } });
      await db.expense.create({
        data: {
          orgId,
          projectId: pid,
          clientId: sp.clientId,
          categoryId: adSpend?.id ?? null,
          date: new Date(),
          amountMinor: 1500000n,
          currencyCode: org.defaultCurrencyCode,
          billable: false,
          description: "Meta Ads spend (managed, pass-through)",
        },
      });
    }
  }

  await seedSalesDocs(orgId, userId, clientIds, svcIds, gst18?.id ?? null);

  const demoTags = [
    { name: "retainer", color: "emerald" },
    { name: "priority", color: "red" },
    { name: "local", color: "sky" },
  ];
  for (const t of demoTags) {
    const tag = await db.tag.upsert({
      where: { orgId_name: { orgId, name: t.name } },
      create: { orgId, name: t.name, color: t.color },
      update: { color: t.color },
    });
    const clientKey = t.name === "local" ? "clinic" : t.name === "priority" ? "lumen" : "verda";
    const cid = (await db.client.findFirst({ where: { orgId, name: { contains: clientKey === "lumen" ? "Lumen" : clientKey === "verda" ? "Verda" : "BrightSmile" } } }));
    if (cid) {
      await db.resourceTag.upsert({
        where: { tagId_entityType_entityId: { tagId: tag.id, entityType: "CLIENT", entityId: cid.id } },
        create: { tagId: tag.id, orgId, entityType: "CLIENT", entityId: cid.id },
        update: {},
      });
    }
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

async function seedSalesDocs(
  orgId: string,
  userId: string,
  clientIds: Record<string, string>,
  svcIds: Record<string, string>,
  gstRateId: string | null,
) {
  const { nextDocumentNumber } = await import("../src/server/numbering");
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const gst = gstRateId
    ? await db.taxRate.findUnique({ where: { id: gstRateId }, include: { components: true } })
    : null;
  const taxBps = gst?.rateBps ?? 0;
  const componentsTotal = gst ? gst.rateBps : 0;
  void componentsTotal;

  const existingInv = await db.invoice.count({ where: { orgId, partyKind: "CLIENT" } });
  if (existingInv > 0) return;

  const makeInvoice = async (
    clientId: string,
    svcCode: string,
    svcName: string,
    qtyHundredths: number,
    unitPrice: bigint,
    paid: boolean,
  ) => {
    const gross = (unitPrice * BigInt(qtyHundredths)) / 100n;
    const tax = (gross * BigInt(taxBps)) / 10000n;
    const total = gross + tax;
    const number = await db.$transaction((tx) => nextDocumentNumber(tx, orgId, "INVOICE"));
    const created = await db.invoice.create({
      data: {
        orgId,
        clientId,
        partyKind: "CLIENT",
        number,
        status: paid ? "PAID" : "SENT",
        currencyCode: org.defaultCurrencyCode,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 15 * 86400_000),
        subtotalMinor: gross,
        taxMinor: tax,
        totalMinor: total,
        paidMinor: paid ? total : 0n,
        taxBreakdown: [
          { code: "GST", name: `GST ${taxBps / 100}%`, bps: taxBps, baseMinor: Number(gross), taxMinor: Number(tax) },
        ],
        createdByUserId: userId,
        lines: {
          create: [
            {
              description: svcName,
              serviceItemId: svcIds[svcCode] ?? null,
              qtyHundredths,
              unitPriceMinor: unitPrice,
              taxBps,
              taxRateId: gstRateId,
              lineTotalMinor: gross,
              sortOrder: 0,
              sourceType: "MANUAL",
            },
          ],
        },
      },
    });
    if (paid) {
      const payNumber = await db.$transaction((tx) => nextDocumentNumber(tx, orgId, "PAYMENT"));
      await db.payment.create({
        data: {
          orgId,
          clientId,
          invoiceId: created.id,
          number: payNumber,
          method: "UPI",
          status: "COMPLETED",
          amountMinor: total,
          currencyCode: org.defaultCurrencyCode,
          paidAt: new Date(),
          reference: "SEED-UPI-REF",
          recordedByUserId: userId,
        },
      });
    }
    return created;
  };

  await makeInvoice(clientIds.lumen, "SEO-RETAINER", "SEO Retainer — Monthly", 100, 49900n, true);
  await makeInvoice(clientIds.verda, "ADS-SETUP", "Google Ads Campaign Setup", 100, 25000n, false);
  await makeInvoice(clientIds.clinic, "CONTENT-PKG", "10 SEO Blog Posts", 100, 39900n, false);

  const quoteNumber = await db.$transaction((tx) => nextDocumentNumber(tx, orgId, "QUOTE"));
  await db.quote.create({
    data: {
      orgId,
      clientId: clientIds.lumen,
      number: quoteNumber,
      status: "SENT",
      currencyCode: org.defaultCurrencyCode,
      issueDate: new Date(),
      validUntil: new Date(Date.now() + 30 * 86400_000),
      subtotalMinor: 250000n,
      taxMinor: 45000n,
      totalMinor: 295000n,
      terms: "Deliverables per attached scope. 50% advance to begin.",
      createdById: userId,
      lines: {
        create: [
          {
            description: "Landing page CRO sprint",
            qtyHundredths: 100,
            unitPriceMinor: 250000n,
            taxBps,
            taxRateId: gstRateId,
            lineTotalMinor: 250000n,
            sortOrder: 0,
          },
        ],
      },
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
