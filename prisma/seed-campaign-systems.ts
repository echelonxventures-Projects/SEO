/**
 * Campaign-systems seed: connector templates (platforms as data), the default
 * media channel catalog, a demo audience and flights. Idempotent.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const TEMPLATES = [
  {
    key: "facebook", name: "Facebook / Meta", protocol: "BUILTIN", icon: "📘",
    capabilities: ["publish", "read_metrics", "audience"], scopes: ["pages_manage_posts", "pages_read_engagement"],
    docsUrl: "https://developers.facebook.com/docs/graph-api",
    config: {},
  },
  {
    key: "x", name: "X (Twitter)", protocol: "BUILTIN", icon: "𝕏",
    capabilities: ["publish"], scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    docsUrl: "https://developer.x.com",
    config: {},
  },
  {
    key: "linkedin", name: "LinkedIn", protocol: "BUILTIN", icon: "💼",
    capabilities: ["publish", "audience"], scopes: ["openid", "profile", "w_member_social"],
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
    config: {},
  },
  {
    key: "demo", name: "Demo channel", protocol: "BUILTIN", icon: "🧪",
    capabilities: ["publish", "read_metrics"], scopes: [], docsUrl: null, config: {},
  },
  {
    key: "mastodon", name: "Mastodon", protocol: "OAUTH2_CODE", icon: "🐘",
    capabilities: ["publish"], scopes: ["read", "write"],
    docsUrl: "https://docs.joinmastodon.org/api/",
    authorizeUrl: "https://mastodon.social/oauth/authorize",
    tokenUrl: "https://mastodon.social/oauth/token",
    apiBase: "https://mastodon.social",
    config: {
      me: { path: "/api/v1/accounts/verify_credentials", idPath: "id", handlePath: "username", namePath: "display_name", picturePath: "avatar" },
      publish: { path: "/api/v1/statuses", body: { status: "{{text}}\n{{linkUrl}}".trimEnd(), visibility: "public" }, idPath: "id", urlPath: "url" },
      accessTokenPath: "access_token", refreshTokenPath: "refresh_token", expiresInPath: "expires_in",
    },
  },
  {
    key: "threads", name: "Threads", protocol: "OAUTH2_CODE", icon: "🧵",
    capabilities: ["publish"], scopes: ["threads_basic", "threads_content_publish"],
    docsUrl: "https://developers.facebook.com/docs/threads",
    authorizeUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    apiBase: "https://graph.threads.net",
    config: {
      me: { path: "/threads/v1.0/me", idPath: "id", handlePath: "username", namePath: "username" },
      publish: { path: "/threads/v1.0/{{accountId}}/threads", body: { text: "{{text}}" }, idPath: "id" },
      accessTokenPath: "access_token", expiresInPath: "expires_in",
    },
  },
];

const CHANNELS = [
  { code: "GOOGLE_SEARCH", name: "Google Search Ads", kind: "SEARCH", costModel: "CPC", connectorKey: null, utmMedium: "cpc", requiresConnection: false, sortOrder: 1 },
  { code: "META_ADS", name: "Meta (Facebook/Instagram)", kind: "SOCIAL", costModel: "CPC", connectorKey: "facebook", utmMedium: "paid-social", requiresConnection: true, sortOrder: 2 },
  { code: "LINKEDIN_ADS", name: "LinkedIn Ads", kind: "SOCIAL", costModel: "CPC", connectorKey: "linkedin", utmMedium: "paid-social", requiresConnection: true, sortOrder: 3 },
  { code: "MASTODON_POSTS", name: "Mastodon posting", kind: "SOCIAL", costModel: "FREE", connectorKey: "mastodon", utmMedium: "social", requiresConnection: true, sortOrder: 4 },
  { code: "EMAIL_BLAST", name: "Email campaigns", kind: "EMAIL", costModel: "FLAT", connectorKey: null, utmMedium: "email", requiresConnection: false, sortOrder: 5 },
  { code: "ORGANIC_SEARCH", name: "Organic SEO", kind: "ORGANIC", costModel: "FREE", connectorKey: null, utmMedium: "organic", requiresConnection: false, sortOrder: 6 },
];

export async function seedCampaignSystems(orgId: string, userId: string) {
  for (const t of TEMPLATES) {
    const existing = await db.connectorTemplate.findFirst({ where: { orgId: null, key: t.key } });
    if (existing) {
      await db.connectorTemplate.update({
        where: { id: existing.id },
        data: {
          name: t.name, protocol: t.protocol as never, icon: t.icon, capabilities: t.capabilities,
          scopes: t.scopes, docsUrl: t.docsUrl, config: t.config,
          authorizeUrl: t.authorizeUrl ?? existing.authorizeUrl,
          tokenUrl: t.tokenUrl ?? existing.tokenUrl,
          apiBase: t.apiBase ?? existing.apiBase,
          builtin: t.protocol === "BUILTIN", active: true,
        },
      });
    } else {
      await db.connectorTemplate.create({
        data: {
          orgId: null, key: t.key, name: t.name, protocol: t.protocol as never, icon: t.icon,
          capabilities: t.capabilities, scopes: t.scopes, docsUrl: t.docsUrl, config: t.config as object,
          authorizeUrl: t.authorizeUrl ?? null, tokenUrl: t.tokenUrl ?? null, apiBase: t.apiBase ?? null,
          builtin: t.protocol === "BUILTIN", sortOrder: TEMPLATES.indexOf(t) * 10,
        },
      });
    }
  }

  for (const c of CHANNELS) {
    const existing = await db.channel.findFirst({ where: { orgId: null, code: c.code } });
    if (existing) {
      await db.channel.update({
        where: { id: existing.id },
        data: { name: c.name, kind: c.kind as never, costModel: c.costModel as never, connectorKey: c.connectorKey, utmMedium: c.utmMedium, requiresConnection: c.requiresConnection, sortOrder: c.sortOrder, active: true },
      });
    } else {
      await db.channel.create({
        data: { orgId: null, code: c.code, name: c.name, kind: c.kind as never, costModel: c.costModel as never, connectorKey: c.connectorKey, utmMedium: c.utmMedium, requiresConnection: c.requiresConnection, sortOrder: c.sortOrder },
      });
    }
  }

  // Demo audience + a flight on the seeded demo campaign (only if missing)
  const audName = "Demo growth subscribers";
  let audience = await db.audience.findFirst({ where: { orgId, name: audName } });
  if (!audience) {
    audience = await db.audience.create({
      data: {
        orgId, name: audName, kind: "PROSPECT_LIST", source: "CSV_UPLOAD",
        description: "Seeded demo target base with per-member consent",
        createdById: userId,
      },
    });
    const members = [
      { email: "priya@acme.test", name: "Priya", company: "Acme", tags: ["vip"] },
      { email: "ramesh@nimbus.test", name: "Ramesh", company: "Nimbus", tags: [] },
      { email: "sofia@bright.example", name: "Sofia", company: "Bright", tags: ["inbound"] },
      { email: "dev@quantum.example", name: "Dev", company: "Quantum", tags: [] },
    ];
    for (const m of members) {
      const key = `e:${createHash("sha256").update(m.email).digest("hex")}`;
      await db.audienceMember.create({
        data: { audienceId: audience.id, orgId, identityKey: key, email: m.email, emailNormalized: m.email, name: m.name, company: m.company, tags: m.tags, consent: "OPT_IN" },
      });
    }
  }

  const campaign = await db.campaign.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } });
  const metaChannel = await db.channel.findFirst({ where: { code: "META_ADS", orgId: null } });
  const emailChannel = await db.channel.findFirst({ where: { code: "EMAIL_BLAST", orgId: null } });
  if (campaign && metaChannel && emailChannel && audience) {
    const existingFlights = await db.campaignFlight.count({ where: { campaignId: campaign.id } });
    if (existingFlights === 0) {
      const start = new Date();
      const end = new Date(Date.now() + 30 * 86400_000);
      await db.campaignFlight.create({
        data: {
          campaignId: campaign.id, orgId, channelId: metaChannel.id, audienceId: audience.id,
          startsAt: start, endsAt: end, status: "APPROVED", createdById: userId,
          cadence: { days: [1, 3, 5], time: "10:00" },
          notes: "Seeded demo flight — approve → generate slots on the demo channel",
        },
      });
      await db.campaignFlight.create({
        data: {
          campaignId: campaign.id, orgId, channelId: emailChannel.id, audienceId: audience.id,
          startsAt: new Date(Date.now() + 3 * 86400_000), endsAt: end, status: "DRAFT", createdById: userId,
        },
      });
    }
  }
  // Demo offer: fully activated lifecycle
  const existingOffer = await db.offer.findFirst({ where: { orgId, code: "DIWALI10" } });
  if (!existingOffer) {
    let offer = await db.offer.create({
      data: {
        orgId, code: "DIWALI10", name: "Diwali 10% welcome discount", kind: "COUPON", valueType: "PERCENT",
        value: 1000, perRecipientLimit: 2, maxRedemptions: 500,
        startsAt: new Date(Date.now() - 86400_000), endsAt: new Date(Date.now() + 60 * 86400_000),
        terms: "One 10% discount per recipient, twice max. Applies to invoice subtotal.", createdById: userId,
      },
    });
    for (const step of ["PENDING_APPROVAL", "APPROVED", "PUBLISHED", "ACTIVE"] as const) {
      offer = await db.offer.update({ where: { id: offer.id }, data: { status: step, ...(step === "APPROVED" ? { approvedById: userId, approvedAt: new Date() } : {}) } });
    }
  }
  console.log("  [campaign systems] connectors, channels, demo audience, flights + DIWALI10 offer ready");
}
