import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { paginationSchema, skipTake, urlish, dateSchema, enumFilter } from "../schemas";
import { sha256 } from "../crypto";
import type { DeviceType, Prisma, SnapshotSource } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertCapacity, assertFeature, assertWritable, audit, requireOwned } from "./common";
import { guardedFetch as fetch } from "../net-guard"; // SSRF-guarded: workspace-controlled URLs

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export const keywordSchema = z.object({
  term: z.string().trim().min(1).max(200),
  device: z.enum(["DESKTOP", "MOBILE"]).default("DESKTOP"),
  locationId: z.string().max(64).nullable().optional(),
  targetUrl: urlish.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
});

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function listKeywords(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const projectId = query.get("projectId");
  const where = {
    orgId: ctx.orgId,
    ...(projectId ? { projects: { some: { projectId } } } : {}),
    ...(p.q ? { normalized: { contains: normalizeTerm(p.q) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.keyword.findMany({
      where,
      ...skipTake(p),
      orderBy: { term: "asc" },
      include: { location: true, snapshots: { orderBy: { capturedOn: "desc" }, take: 31 } },
    }),
    db.keyword.count({ where }),
  ]);
  return {
    total,
    page: p.page,
    pageSize: p.pageSize,
    rows: rows.map((k) => {
      const sorted = [...k.snapshots].sort((a, b) => a.capturedOn.getTime() - b.capturedOn.getTime());
      const current = sorted[sorted.length - 1]?.position ?? null;
      const previous = sorted[sorted.length - 2]?.position ?? null;
      return {
        id: k.id,
        term: k.term,
        device: k.device,
        location: k.location?.name ?? null,
        targetUrl: k.targetUrl,
        currentPosition: current,
        previousPosition: previous,
        change: current != null && previous != null ? previous - current : null,
        series: sorted.map((s) => ({ date: s.capturedOn, position: s.position })),
        trackedDays: sorted.length,
      };
    }),
  };
}

export async function createKeyword(ctx: Ctx, input: unknown) {
  const data = keywordSchema.parse(input);
  await assertWritable(ctx.orgId);
  await assertFeature(ctx.orgId, "RANK_TRACKING");
  const count = await db.keyword.count({ where: { orgId: ctx.orgId } });
  await assertCapacity(ctx.orgId, "KEYWORDS", count + 1);
  const created = await db.$transaction(async (tx) => {
    const kw = await tx.keyword
      .create({
        data: {
          orgId: ctx.orgId,
          term: data.term,
          normalized: normalizeTerm(data.term),
          device: data.device,
          locationId: data.locationId ?? null,
          targetUrl: data.targetUrl ?? null,
          notes: data.notes ?? null,
        },
      })
      .catch(() => {
        throw new AppError(ErrorCodes.CONFLICT, "This keyword (term + device + location) is already tracked");
      });
    if (data.projectId) {
      await requireOwned(await tx.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
      await tx.projectKeyword.upsert({
        where: { projectId_keywordId: { projectId: data.projectId, keywordId: kw.id } },
        create: { projectId: data.projectId, keywordId: kw.id },
        update: {},
      });
    }
    await audit(tx, ctx, "seo.keyword_created", undefined, kw.id, { term: data.term });
    return kw.id;
  });
  return { id: created };
}

export async function deleteKeyword(ctx: Ctx, id: string) {
  await requireOwned(await db.keyword.findUnique({ where: { id } }), "Keyword", ctx.orgId);
  await db.keyword.delete({ where: { id } });
  await audit(db, ctx, "seo.keyword_deleted", undefined, id);
}

// ---------------------------------------------------------------------------
// Rank snapshots
// ---------------------------------------------------------------------------

export const snapshotSchema = z.object({
  keywordId: z.string().min(1),
  capturedOn: dateSchema,
  position: z.number().int().min(0).max(1000),
  trackedUrl: urlish.nullable().optional(),
});

export async function upsertSnapshot(ctx: Ctx, input: unknown, source: SnapshotSource = "MANUAL") {
  const data = snapshotSchema.parse(input);
  const kw = await requireOwned(await db.keyword.findUnique({ where: { id: data.keywordId } }), "Keyword", ctx.orgId);
  const capturedOn = new Date(data.capturedOn);
  capturedOn.setUTCHours(0, 0, 0, 0);
  const snapshot = await db.rankSnapshot.upsert({
    where: { keywordId_capturedOn: { keywordId: kw.id, capturedOn } },
    create: {
      orgId: ctx.orgId,
      keywordId: kw.id,
      capturedOn,
      position: data.position,
      trackedUrl: data.trackedUrl ?? null,
      source,
    },
    update: { position: data.position, trackedUrl: data.trackedUrl ?? null, source },
  });
  await audit(db, ctx, "seo.snapshot_recorded", undefined, kw.id, { position: data.position, source });
  return snapshot;
}

/**
 * CSV import: `term,position,capturedOn[,device][,location]` with a header row.
 * Rows referencing unknown keywords create them (matching term+device+location).
 */
export async function importRankCsv(ctx: Ctx, csv: string) {
  await assertWritable(ctx.orgId);
  await assertFeature(ctx.orgId, "RANK_TRACKING");
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new AppError(ErrorCodes.VALIDATION, "CSV needs a header row and at least one data row");
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const idx = {
    term: header.indexOf("term"),
    position: header.indexOf("position"),
    capturedon: header.indexOf("capturedon"),
    device: header.indexOf("device"),
    location: header.indexOf("location"),
  };
  if (idx.term < 0 || idx.position < 0 || idx.capturedon < 0) {
    throw new AppError(ErrorCodes.VALIDATION, 'CSV header must include at least "term,position,capturedOn"');
  }
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const term = cols[idx.term]?.trim();
    if (!term) {
      errors.push(`row ${i + 1}: missing term`);
      continue;
    }
    const position = Number(cols[idx.position]);
    if (!Number.isInteger(position) || position < 0 || position > 1000) {
      errors.push(`row ${i + 1}: invalid position`);
      continue;
    }
    const dateRaw = cols[idx.capturedon]?.trim();
    const date = new Date(dateRaw ?? "");
    if (Number.isNaN(date.getTime())) {
      errors.push(`row ${i + 1}: invalid date (use YYYY-MM-DD)`);
      continue;
    }
    const deviceRaw = (idx.device >= 0 ? cols[idx.device] : "")?.toUpperCase().trim();
    const device: DeviceType = deviceRaw === "MOBILE" ? "MOBILE" : "DESKTOP";
    const locationName = idx.location >= 0 ? cols[idx.location]?.trim() : "";
    date.setUTCHours(0, 0, 0, 0);
    const result = await db.$transaction(async (tx) => {
      let locationId: string | null = null;
      if (locationName) {
        const loc =
          (await tx.geoLocation.findFirst({ where: { orgId: ctx.orgId, name: locationName } })) ??
          (await tx.geoLocation.create({ data: { orgId: ctx.orgId, name: locationName } }));
        locationId = loc.id;
      }
      const kw =
        (await tx.keyword.findFirst({ where: { orgId: ctx.orgId, normalized: normalizeTerm(term), device, locationId } })) ??
        (await tx.keyword.create({
          data: { orgId: ctx.orgId, term, normalized: normalizeTerm(term), device, locationId },
        }));
      const existed = await tx.rankSnapshot.findUnique({
        where: { keywordId_capturedOn: { keywordId: kw.id, capturedOn: date } },
        select: { id: true },
      });
      await tx.rankSnapshot.upsert({
        where: { keywordId_capturedOn: { keywordId: kw.id, capturedOn: date } },
        create: { orgId: ctx.orgId, keywordId: kw.id, capturedOn: date, position, source: "CSV_IMPORT" },
        update: { position, source: "CSV_IMPORT" },
      });
      return { isNew: !existed, kw };
    });
    if (result.isNew) created++;
    else updated++;
  }
  await audit(db, ctx, "seo.csv_import", undefined, undefined, { created, updated, errors: errors.length });
  return { created, updated, errors: errors.slice(0, 20) };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// SERP refresh providers (data-driven; demo provider for sandbox flows)
// ---------------------------------------------------------------------------

type SerpProvider = {
  code: string;
  label: string;
  lookup(opts: { term: string; device: DeviceType; location: string | null; seed: string }): Promise<number>;
};

const demoSerp: SerpProvider = {
  code: "demo",
  label: "Demo SERP (synthetic, deterministic)",
  async lookup({ term, device, location, seed }) {
    const h = parseInt(sha256(`${term}|${device}|${location ?? ""}|${seed}`).slice(0, 8), 16);
    const dayOffset = Math.floor(Date.now() / 86400_000) % 12;
    return 1 + ((h + dayOffset * 7) % 30);
  },
};

const serpProviders = new Map<string, SerpProvider>([[demoSerp.code, demoSerp]]);

export async function refreshRanksFromProvider(ctx: Ctx) {
  await assertFeature(ctx.orgId, "RANK_TRACKING");
  const setting = await db.systemSetting.findUnique({ where: { key: "seo.serp_provider" } });
  const code = (setting?.value as { code?: string } | undefined)?.code ?? demoSerp.code;
  const provider = serpProviders.get(code);
  if (!provider) {
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      `SERP provider "${code}" is not implemented. Configure an available provider (${[...serpProviders.keys()].join(", ")}).`,
    );
  }
  const keywords = await db.keyword.findMany({
    where: { orgId: ctx.orgId },
    include: { location: true },
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let written = 0;
  for (const kw of keywords) {
    const position = await provider.lookup({
      term: kw.term,
      device: kw.device,
      location: kw.location?.name ?? null,
      seed: `${today.toISOString()}:${ctx.orgId}`,
    });
    await db.rankSnapshot.upsert({
      where: { keywordId_capturedOn: { keywordId: kw.id, capturedOn: today } },
      create: { orgId: ctx.orgId, keywordId: kw.id, capturedOn: today, position, source: provider.code === "demo" ? "DEMO" : "PROVIDER" },
      update: { position, source: provider.code === "demo" ? "DEMO" : "PROVIDER" },
    });
    written++;
  }
  await audit(db, ctx, "seo.ranks_refreshed", undefined, undefined, { provider: provider.code, written });
  return { provider: provider.code, written };
}

export function listSerpProviders() {
  return [...serpProviders.values()].map((p) => ({ code: p.code, label: p.label }));
}

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export const backlinkSchema = z.object({
  sourceUrl: urlish,
  targetUrl: urlish,
  anchorText: z.string().trim().max(500).nullable().optional(),
  dofollow: z.boolean().default(true),
  domainAuthority: z.number().int().min(0).max(100).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function listBacklinks(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const status = query.get("status");
  const where = {
    orgId: ctx.orgId,
    status: enumFilter(status, ["LIVE", "LOST", "BROKEN", "REMOVED"] as const),
    ...(p.q ? { OR: [{ sourceUrl: { contains: p.q } }, { targetUrl: { contains: p.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.backlink.findMany({ where, ...skipTake(p), orderBy: { firstSeenAt: "desc" } }),
    db.backlink.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function addBacklink(ctx: Ctx, input: unknown) {
  const data = backlinkSchema.parse(input);
  await assertFeature(ctx.orgId, "BACKLINK_INDEX");
  if (data.projectId) {
    await requireOwned(await db.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
  }
  await db.backlink
    .create({
      data: {
        orgId: ctx.orgId,
        projectId: data.projectId ?? null,
        sourceUrl: data.sourceUrl,
        targetUrl: data.targetUrl,
        anchorText: data.anchorText ?? null,
        dofollow: data.dofollow,
        domainAuthority: data.domainAuthority ?? null,
        notes: data.notes ?? null,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "This source→target link is already indexed");
    });
  await audit(db, ctx, "seo.backlink_added");
}

export async function checkBacklink(ctx: Ctx, id: string) {
  const link = await requireOwned(await db.backlink.findUnique({ where: { id } }), "Backlink", ctx.orgId);
  let status: "LIVE" | "BROKEN" | "LOST" = "LOST";
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(link.sourceUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "OmniMarkBot/1.0 (+link-checker)" },
      cache: "no-store",
    });
    clearTimeout(t);
    if (res.ok) {
      const body = await res.text();
      status = body.includes(link.targetUrl) || body.includes(link.sourceUrl) ? "LIVE" : "BROKEN";
    } else if (res.status >= 500) {
      status = "LOST";
    } else {
      status = "BROKEN";
    }
  } catch {
    status = "LOST";
  }
  return db.backlink.update({ where: { id }, data: { status, lastCheckedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Site audit engine (real fetch + on-page heuristics; no external APIs)
// ---------------------------------------------------------------------------

type CheckResult = {
  code: string;
  category: string;
  pass: boolean;
  severity: "CRITICAL" | "ERROR" | "WARNING" | "NOTICE" | "PASS";
  message: string;
  weight: number;
  detail?: Record<string, unknown>;
};

const CHECK_WEIGHTS: Record<string, number> = {
  indexability: 25,
  onpage: 25,
  technical: 20,
  content: 15,
  social: 10,
  performance: 5,
};

function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<meta\\s[^>]*name=["']${name}["'][^>]*>`, "i"));
  if (!m) return null;
  const c = m[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1] : "";
}

function tag(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m && m[1] ? m[1].trim() : m ? "" : null;
}

export async function runSiteAudit(ctx: Ctx, input: unknown) {
  const data = z.object({ url: urlish, projectId: z.string().max(64).nullable().optional() }).parse(input);
  await assertWritable(ctx.orgId);
  await assertFeature(ctx.orgId, "SITE_AUDIT");
  if (data.projectId) {
    await requireOwned(await db.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
  }
  const url = new URL(data.url);
  if (!/^https?:$/.test(url.protocol)) {
    throw new AppError(ErrorCodes.VALIDATION, "Only http(s) URLs can be audited");
  }
  const siteAudit = await db.siteAudit.create({
    data: {
      orgId: ctx.orgId,
      projectId: data.projectId ?? null,
      url: data.url,
      status: "RUNNING",
      requestedById: ctx.userId,
    },
  });
  const results: CheckResult[] = [];
  const add = (r: CheckResult) => results.push(r);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const t0 = Date.now();
    const res = await fetch(data.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OmniMarkBot/1.0; +site-audit)" },
      cache: "no-store",
    });
    const elapsedMs = Date.now() - t0;
    clearTimeout(timer);
    const html = await res.text();

    add({ code: "http_status", category: "technical", pass: res.ok, severity: res.ok ? "PASS" : "CRITICAL", weight: 1, message: res.ok ? `Response ${res.status}` : `Server returned ${res.status}` });
    add({ code: "https", category: "security", pass: url.protocol === "https:", severity: url.protocol === "https:" ? "PASS" : "ERROR", weight: 1, message: url.protocol === "https:" ? "Served over HTTPS" : "Page is not served over HTTPS" });

    const title = tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? attr(html, "title");
    add({ code: "title", category: "onpage", pass: Boolean(title && title.length >= 10 && title.length <= 70), severity: title ? (title.length < 10 || title.length > 70 ? "WARNING" : "PASS") : "ERROR", weight: 2, message: title ? `Title: “${title.slice(0, 80)}” (${title.length} chars)` : "Missing <title>" });

    const desc = attr(html, "description");
    add({ code: "meta_description", category: "onpage", pass: Boolean(desc && desc.length >= 50 && desc.length <= 160), severity: desc ? (desc.length < 50 ? "WARNING" : "PASS") : "ERROR", weight: 2, message: desc ? `Meta description ${desc.length} chars` : "Missing meta description" });

    const robots = attr(html, "robots") ?? "";
    add({ code: "noindex", category: "indexability", pass: !/noindex/i.test(robots), severity: /noindex/i.test(robots) ? "CRITICAL" : "PASS", weight: 3, message: /noindex/i.test(robots) ? "Page blocks indexing (meta robots noindex)" : "Indexable by robots meta" });

    const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*>/i)?.[0] ?? "").match(/href=["']([^"']+)["']/i)?.[1];
    add({ code: "canonical", category: "technical", pass: Boolean(canonical), severity: canonical ? "PASS" : "WARNING", weight: 2, message: canonical ? `Canonical → ${canonical.slice(0, 100)}` : "Missing canonical link" });

    const h1s = (html.match(/<h1[\s>]/gi) ?? []).length;
    add({ code: "h1", category: "onpage", pass: h1s === 1, severity: h1s === 1 ? "PASS" : h1s === 0 ? "ERROR" : "WARNING", weight: 2, message: h1s === 1 ? "Single H1 present" : `${h1s} H1 element(s) found` });

    const imgs = html.match(/<img[\s>][^>]*>/gi) ?? [];
    const missingAlt = imgs.filter((i) => !/\balt=/.test(i)).length;
    add({ code: "img_alt", category: "content", pass: missingAlt === 0, severity: missingAlt === 0 ? "PASS" : "WARNING", weight: 1, message: missingAlt === 0 ? `All ${imgs.length} images have alt attributes` : `${missingAlt}/${imgs.length} images missing alt text` });

    const viewport = attr(html, "viewport");
    add({ code: "viewport", category: "technical", pass: Boolean(viewport), severity: viewport ? "PASS" : "ERROR", weight: 2, message: viewport ? "Responsive viewport declared" : "Missing viewport meta tag" });

    const ogTitle = tag(html, /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
    const ogDesc = tag(html, /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
    add({ code: "open_graph", category: "social", pass: Boolean(ogTitle && ogDesc), severity: ogTitle && ogDesc ? "PASS" : "NOTICE", weight: 1, message: ogTitle && ogDesc ? "Open Graph title & description set" : "Incomplete Open Graph tags (social previews weak)" });

    const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
    add({ code: "word_count", category: "content", pass: words >= 300, severity: words >= 300 ? "PASS" : "WARNING", weight: 1, message: `≈${words} words of body text` });

    const internalLinks = (html.match(/<a[^>]*href=["'](?!https?:\/\/|mailto:|tel:|#)/gi) ?? []).length + (html.match(new RegExp(`<a[^>]*href=["']https?://${url.hostname.replace(/\./g, "\\.")}`, "gi")) ?? []).length;
    add({ code: "internal_links", category: "content", pass: internalLinks > 0, severity: internalLinks > 0 ? "PASS" : "WARNING", weight: 1, message: `${internalLinks} internal links` });

    add({ code: "response_time", category: "performance", pass: elapsedMs < 1500, severity: elapsedMs < 1500 ? "PASS" : "WARNING", weight: 1, message: `HTML served in ${elapsedMs} ms`, detail: { elapsedMs } });

    // robots.txt + sitemap.xml on the same origin
    const robotsRes = await fetch(`${url.protocol}//${url.host}/robots.txt`, { headers: { "User-Agent": "OmniMarkBot/1.0" }, cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    const robotsText = robotsRes?.ok ? await robotsRes.text() : "";
    const gptDisallowed = /disallow:\s*\/\s*$/im.test(robotsText);
    add({ code: "robots_txt", category: "indexability", pass: Boolean(robotsRes?.ok) && !gptDisallowed, severity: !robotsRes?.ok ? "NOTICE" : gptDisallowed ? "CRITICAL" : "PASS", weight: 2, message: !robotsRes?.ok ? "No readable robots.txt" : gptDisallowed ? "robots.txt disallows crawling of /" : "robots.txt readable and crawl-friendly" });
    if (/noindex/i.test(robotsText)) {
      add({ code: "x_robots_noindex", category: "indexability", pass: false, severity: "CRITICAL", weight: 3, message: "robots.txt contains an X-Robots-Tag/Noindex directive" });
    }
    const sitemapRes = await fetch(`${url.protocol}//${url.host}/sitemap.xml`, { headers: { "User-Agent": "OmniMarkBot/1.0" }, cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
    add({ code: "sitemap", category: "indexability", pass: Boolean(sitemapRes?.ok), severity: sitemapRes?.ok ? "PASS" : "WARNING", weight: 2, message: sitemapRes?.ok ? "sitemap.xml is reachable" : "sitemap.xml not found at /sitemap.xml" });
  } catch (err) {
    await db.siteAudit.update({
      where: { id: siteAudit.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "fetch failed", finishedAt: new Date() },
    });
    throw new AppError(ErrorCodes.VALIDATION, "Could not fetch the URL — is it publicly reachable?");
  }

  const byCat = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const b = byCat.get(r.category) ?? { pass: 0, total: 0 };
    b.total++;
    if (r.pass) b.pass++;
    byCat.set(r.category, b);
  }
  let score = 0;
  let weightSum = 0;
  for (const [cat, { pass, total }] of byCat) {
    const w = CHECK_WEIGHTS[cat] ?? 5;
    score += (pass / total) * w;
    weightSum += w;
  }
  score = Math.round((score / weightSum) * 100);

  await db.$transaction(async (tx) => {
    await tx.siteAuditIssue.createMany({
      data: results.map((r) => ({
        auditId: siteAudit.id,
        checkCode: r.code,
        category: r.category,
        severity: r.severity === "PASS" ? ("PASS" as const) : r.severity,
        message: r.message,
        detail: (r.detail ?? {}) as Prisma.InputJsonValue,
      })),
    });
    await tx.siteAudit.update({
      where: { id: siteAudit.id },
      data: {
        status: "COMPLETED",
        score,
        passedCount: results.filter((r) => r.pass).length,
        issueCount: results.filter((r) => !r.pass).length,
        finishedAt: new Date(),
        summary: Object.fromEntries([...byCat.entries()].map(([c, v]) => [c, v])) as Prisma.InputJsonValue,
      },
    });
    await audit(tx, ctx, "seo.audit_completed", undefined, siteAudit.id, { score });
  });
  return { auditId: siteAudit.id, score, issues: results.filter((r) => !r.pass).length };
}

export async function listAudits(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const where = { orgId: ctx.orgId };
  const [rows, total] = await Promise.all([
    db.siteAudit.findMany({
      where,
      ...skipTake(p),
      orderBy: { startedAt: "desc" },
      include: { project: { select: { id: true, name: true } }, requestedBy: { select: { name: true } } },
    }),
    db.siteAudit.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getAudit(ctx: Ctx, id: string) {
  const a = await requireOwned(
    await db.siteAudit.findUnique({
      where: { id },
      include: { issues: { orderBy: [{ severity: "asc" }, { category: "asc" }] }, project: { select: { id: true, name: true } } },
    }),
    "Site audit",
    ctx.orgId,
  );
  return a;
}

export async function seoSummary(ctx: Ctx) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const keywords = await db.keyword.findMany({
    where: { orgId: ctx.orgId },
    include: { snapshots: { orderBy: { capturedOn: "desc" }, take: 40 } },
  });
  let improved = 0;
  let declined = 0;
  let flat = 0;
  let to10 = 0;
  let sumPos = 0;
  let counted = 0;
  for (const k of keywords) {
    const sorted = [...k.snapshots].sort((a, b) => a.capturedOn.getTime() - b.capturedOn.getTime());
    const current = sorted[sorted.length - 1];
    if (!current) continue;
    counted++;
    sumPos += current.position;
    if (current.position <= 10) to10++;
    const past = sorted.find((s) => s.capturedOn <= weekAgo);
    if (!past || past.position === current.position) flat++;
    else if (current.position < past.position) improved++;
    else declined++;
  }
  return {
    keywords: keywords.length,
    tracked: counted,
    improved,
    declined,
    flat,
    top10: to10,
    avgPosition: counted ? Math.round((sumPos / counted) * 10) / 10 : null,
    audits: await db.siteAudit.count({ where: { orgId: ctx.orgId } }),
    lastAudit: await db.siteAudit.findFirst({ where: { orgId: ctx.orgId, status: "COMPLETED" }, orderBy: { startedAt: "desc" }, select: { score: true, startedAt: true, url: true } }),
    backlinks: await db.backlink.groupBy({ by: ["status"], where: { orgId: ctx.orgId }, _count: true }),
  };
}
