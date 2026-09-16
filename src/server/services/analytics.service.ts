import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, paginationSchema, skipTake } from "../schemas";
import { minorToNumber } from "../money";
import type { ReportModule } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertFeature, audit, requireOwned } from "./common";
import { seoSummary } from "./seo.service";
import { refreshOverdue } from "./sales.service";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBack(n: number): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - (n - 1));
  return d;
}

export async function dashboardOverview(ctx: Ctx, months = 12) {
  await refreshOverdue(ctx.orgId);
  const since = monthsBack(Math.min(Math.max(months, 1), 24));
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.orgId },
    include: { defaultCurrency: { select: { symbol: true } } },
  });

  const [
    payments,
    invoicesOutstanding,
    overdueAgg,
    leadsOpen,
    projects,
    clientsActive,
    timeByUser,
    campaignAgg,
    campaignMonthly,
    recentPayments,
    activity,
    seo,
  ] = await Promise.all([
    db.payment.aggregate({
      where: { orgId: ctx.orgId, status: "COMPLETED", paidAt: { gte: since } },
      _sum: { amountMinor: true },
    }),
    db.invoice.aggregate({
      where: { orgId: ctx.orgId, partyKind: "CLIENT", status: { in: ["ISSUED", "SENT", "PARTIALLY_PAID"] } },
      _sum: { totalMinor: true, paidMinor: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: { orgId: ctx.orgId, partyKind: "CLIENT", status: "OVERDUE" },
      _sum: { totalMinor: true },
      _count: true,
    }),
    db.lead.aggregate({
      where: { orgId: ctx.orgId, convertedClientId: null, stage: { isTerminalLost: false } },
      _sum: { budgetMinor: true },
      _count: true,
    }),
    db.project.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } }),
    db.client.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } }),
    db.timeEntry.groupBy({
      by: ["userId"],
      where: { orgId: ctx.orgId, date: { gte: since }, billable: true },
      _sum: { minutes: true },
    }),
    db.campaignMetric.groupBy({
      by: ["orgId"],
      where: { orgId: ctx.orgId, date: { gte: since } },
      _sum: { costMinor: true, revenueMinor: true, clicks: true, conversions: true },
    }),
    db.campaignMetric.findMany({
      where: { orgId: ctx.orgId, date: { gte: since } },
      select: { date: true, costMinor: true, revenueMinor: true },
    }),
    db.payment.findMany({
      where: { orgId: ctx.orgId, status: "COMPLETED", paidAt: { gte: since } },
      orderBy: { paidAt: "desc" },
      take: 8,
      include: { client: { select: { name: true } }, invoice: { select: { number: true } } },
    }),
    db.activityLog.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { user: { select: { name: true } } },
    }),
    seoSummary(ctx),
  ]);

  // Revenue per month (payments + issued totals) over the window.
  const paymentsMonthly = await db.payment.groupBy({
    by: ["paidAt"],
    where: { orgId: ctx.orgId, status: "COMPLETED", paidAt: { gte: since } },
    _sum: { amountMinor: true },
  });
  const revenueSeries = new Map<string, number>();
  const start = new Date(since);
  for (let i = 0; ; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    if (d > new Date()) break;
    revenueSeries.set(monthKey(d), 0);
  }
  for (const row of paymentsMonthly) {
    if (!row.paidAt) continue;
    const key = monthKey(row.paidAt);
    if (revenueSeries.has(key)) {
      revenueSeries.set(key, (revenueSeries.get(key) ?? 0) + minorToNumber(row._sum.amountMinor ?? 0n) / 100);
    }
  }
  const campaignSeries = new Map<string, { cost: number; revenue: number }>();
  for (const m of campaignMonthly) {
    const key = monthKey(m.date);
    const cur = campaignSeries.get(key) ?? { cost: 0, revenue: 0 };
    cur.cost += minorToNumber(m.costMinor) / 100;
    cur.revenue += minorToNumber(m.revenueMinor) / 100;
    campaignSeries.set(key, cur);
  }
  const users = await db.user.findMany({
    where: { id: { in: timeByUser.map((t) => t.userId) } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));

  return {
    currency: { code: org.defaultCurrencyCode, symbol: org.defaultCurrency?.symbol ?? "" },
    kpis: {
      collectedMinor: minorToNumber(payments._sum.amountMinor ?? 0n),
      outstandingMinor: minorToNumber((invoicesOutstanding._sum.totalMinor ?? 0n) - (invoicesOutstanding._sum.paidMinor ?? 0n)),
      outstandingCount: invoicesOutstanding._count,
      overdueMinor: minorToNumber(overdueAgg._sum.totalMinor ?? 0n),
      overdueCount: overdueAgg._count,
      openLeads: leadsOpen._count,
      pipelineMinor: minorToNumber(leadsOpen._sum.budgetMinor ?? 0n),
      activeProjects: projects,
      activeClients: clientsActive,
      campaignCostMinor: minorToNumber(campaignAgg[0]?._sum.costMinor ?? 0n),
      campaignRevenueMinor: minorToNumber(campaignAgg[0]?._sum.revenueMinor ?? 0n),
      campaignClicks: Number(campaignAgg[0]?._sum.clicks ?? 0),
      campaignConversions: Number(campaignAgg[0]?._sum.conversions ?? 0),
      seo,
    },
    revenueByMonth: [...revenueSeries.entries()].map(([month, amount]) => ({ month, amount })),
    campaignByMonth: [...campaignSeries.entries()].map(([month, v]) => ({ month, ...v })),
    timeByMember: timeByUser.map((t) => ({
      name: userName.get(t.userId) ?? "Unknown",
      minutes: t._sum.minutes ?? 0,
    })),
    recentPayments: recentPayments.map((p) => ({
      id: p.id,
      number: p.number,
      client: p.client?.name ?? null,
      invoice: p.invoice?.number ?? null,
      amountMinor: minorToNumber(p.amountMinor),
      paidAt: p.paidAt,
      method: p.method,
    })),
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      user: a.user?.name ?? "system",
      entity: a.entityType && a.entityId ? `${a.entityType}:${a.entityId}` : null,
      at: a.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportSchema = z.object({
  name: nameish,
  module: z.enum(["REVENUE", "CLIENTS", "SEO_RANKINGS", "CAMPAIGNS", "TIMESHEETS", "TEAM"]),
  definition: z.object({
    months: z.number().int().min(1).max(24).default(12),
    clientId: z.string().max(64).nullable().default(null),
  }),
  schedule: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).default("NONE"),
  patternId: z.string().max(64).nullable().optional(), // UTP temporal asset — the canonical recurring schedule
});

/** Legacy enum → UTP recurrence spec (centralized: the enum is only a fallback). */
export function legacyScheduleSpec(schedule: string): { freq: "DAILY"; interval: 1; time: string; durationMinutes: 0 } | { freq: "WEEKLY"; interval: 1; weekdays: number[]; time: string; durationMinutes: 0 } | { freq: "MONTHLY"; interval: 1; monthdays: number[]; time: string; durationMinutes: 0 } | null {
  if (schedule === "DAILY") return { freq: "DAILY", interval: 1, time: "08:00", durationMinutes: 0 };
  if (schedule === "WEEKLY") return { freq: "WEEKLY", interval: 1, weekdays: [1], time: "08:00", durationMinutes: 0 };
  if (schedule === "MONTHLY") return { freq: "MONTHLY", interval: 1, monthdays: [1], time: "08:00", durationMinutes: 0 };
  return null;
}

async function nextRunFor(orgId: string, patternId: string | null, schedule: string): Promise<{ next: Date | null; spec: object | null; patternTimezone: string | null }> {
  const { nextOccurrence } = await import("../temporal/recurrence");
  if (patternId) {
    const pat = await db.temporalPattern.findUnique({ where: { id: patternId } });
    if (pat) {
      const { expandPattern } = await import("./temporal-frame");
      const from = new Date();
      const occ = (await expandPattern(pat, from, new Date(from.getTime() + 400 * 86_400_000), { max: 1 }))[0];
      return { next: occ ? occ.startsAt : null, spec: pat.spec as object, patternTimezone: pat.timezone };
    }
  }
  const spec = legacyScheduleSpec(schedule);
  if (!spec) return { next: null, spec: null, patternTimezone: null };
  const cfg = await db.temporalConfiguration.findUnique({ where: { orgId } });
  const occ = nextOccurrence(spec as never, new Date(), cfg?.timezone ?? "UTC", 400);
  return { next: occ ? occ.startsAt : null, spec, patternTimezone: cfg?.timezone ?? "UTC" };
}

export async function createReport(ctx: Ctx, input: unknown) {
  const data = reportSchema.parse(input);
  await assertFeature(ctx.orgId, "REPORT_BUILDER");
  if (data.patternId) {
    const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.patternId } }), "Pattern", ctx.orgId);
    if (pat.freq === "NONE") throw new AppError(ErrorCodes.VALIDATION, "Recurring reports need a recurring pattern");
  }
  const sched = await nextRunFor(ctx.orgId, data.patternId ?? null, data.schedule);
  const report = await db.report.create({
    data: {
      orgId: ctx.orgId,
      name: data.name,
      module: data.module,
      definition: data.definition,
      schedule: data.schedule,
      patternId: data.patternId ?? null,
      nextScheduledAt: sched.next,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "report.created", undefined, report.id, { module: data.module, nextScheduledAt: sched.next });
  return report;
}

export async function updateReport(ctx: Ctx, id: string, input: unknown) {
  const data = reportSchema.partial().parse(input);
  const report = await requireOwned(await db.report.findUnique({ where: { id } }), "Report", ctx.orgId);
  if (data.patternId) await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.patternId } }), "Pattern", ctx.orgId);
  const sched = await nextRunFor(ctx.orgId, data.patternId ?? report.patternId, (data.schedule ?? report.schedule) as string);
  const updated = await db.report.update({
    where: { id },
    data: {
      name: data.name,
      definition: data.definition as object | undefined,
      schedule: data.schedule as never,
      patternId: data.patternId,
      nextScheduledAt: sched.next,
    },
  });
  await audit(db, ctx, "report.updated", undefined, id, { fields: Object.keys(data) });
  return updated;
}

/** Cron pass: run reports whose centralized UTP schedule has come due. */
export async function runDueReports(now = new Date()): Promise<{ ran: number; due: number }> {
  const due = await db.report.findMany({
    where: { nextScheduledAt: { not: null, lte: now } },
    take: 25,
    orderBy: { nextScheduledAt: "asc" },
  });
  let ran = 0;
  for (const report of due) {
    const actorId = report.createdById ?? (await db.membership.findFirst({ where: { orgId: report.orgId, role: { code: "OWNER" } }, select: { userId: true } }))?.userId;
    if (!actorId) continue;
    try {
      await runReport({ viewer: null as never, orgId: report.orgId, userId: actorId, ip: null }, report.id);
      const next = await nextRunFor(report.orgId, report.patternId, report.schedule as string);
      await db.report.update({
        where: { id: report.id },
        data: { lastScheduledAt: report.nextScheduledAt, nextScheduledAt: next.next ?? (next.next === null ? null : undefined) },
      });
      ran++;
    } catch {
      await db.report.update({ where: { id: report.id }, data: { nextScheduledAt: new Date(now.getTime() + 3_600_000) } });
    }
  }
  await db.systemSetting.upsert({
    where: { key: "cron:reports" },
    create: { key: "cron:reports", value: { at: now.toISOString(), ran } },
    update: { value: { at: now.toISOString(), ran } },
  });
  return { ran, due: due.length };
}

export async function deleteReport(ctx: Ctx, id: string) {
  await requireOwned(await db.report.findUnique({ where: { id } }), "Report", ctx.orgId);
  await db.report.delete({ where: { id } });
  await audit(db, ctx, "report.deleted", undefined, id);
}

export async function listReports(ctx: Ctx) {
  return db.report.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { ranAt: "desc" }, take: 1 }, pattern: { select: { id: true, name: true, dsl: true } } },
  });
}

export type ReportResult = {
  columns: Array<{ key: string; label: string; type: "text" | "number" | "money" | "date" }>;
  rows: Array<Record<string, unknown>>;
  summary: Record<string, number>;
};

export async function runReport(ctx: Ctx, id: string): Promise<ReportResult> {
  const report = await requireOwned(await db.report.findUnique({ where: { id } }), "Report", ctx.orgId);
  const definition = report.definition as { months: number; clientId: string | null };
  const since = monthsBack(definition.months);
  const result = await computeReport(ctx.orgId, report.module, since, definition.clientId);
  await db.reportRun.create({
    data: {
      reportId: id,
      triggeredByUserId: ctx.userId,
      resultSummary: result.summary as object,
    },
  });
  await audit(db, ctx, "report.ran", undefined, id, { module: report.module });
  return result;
}

async function computeReport(
  orgId: string,
  module: ReportModule,
  since: Date,
  clientId: string | null,
): Promise<ReportResult> {
  if (module === "REVENUE") {
    const payments = await db.payment.groupBy({
      by: ["paidAt"],
      where: { orgId, status: "COMPLETED", paidAt: { gte: since }, ...(clientId ? { clientId } : {}) },
      _sum: { amountMinor: true },
    });
    const byMonth = new Map<string, number>();
    for (const p of payments) {
      const key = monthKey(p.paidAt);
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(p._sum.amountMinor ?? 0n));
    }
    const rows = [...byMonth.entries()].map(([month, minor]) => ({ month, amountMinor: minor }));
    return {
      columns: [
        { key: "month", label: "Month", type: "text" },
        { key: "amountMinor", label: "Collected (minor)", type: "money" },
      ],
      rows,
      summary: { totalMinor: rows.reduce((a, r) => a + Number(r.amountMinor), 0) },
    };
  }
  if (module === "CLIENTS") {
    const rows = await db.client.findMany({
      where: { orgId, ...(clientId ? { id: clientId } : {}) },
      include: {
        _count: { select: { projects: true, invoices: true } },
        invoices: { where: { status: { not: "VOID" } }, select: { totalMinor: true, paidMinor: true } },
      },
    });
    const data = rows.map((c) => ({
      name: c.name,
      projects: c._count.projects,
      invoices: c._count.invoices,
      billedMinor: Number(c.invoices.reduce((a, i) => a + i.totalMinor, 0n)),
      paidMinor: Number(c.invoices.reduce((a, i) => a + i.paidMinor, 0n)),
    }));
    return {
      columns: [
        { key: "name", label: "Client", type: "text" },
        { key: "projects", label: "Projects", type: "number" },
        { key: "invoices", label: "Invoices", type: "number" },
        { key: "billedMinor", label: "Billed (minor)", type: "money" },
        { key: "paidMinor", label: "Paid (minor)", type: "money" },
      ],
      rows: data,
      summary: {
        billedMinor: data.reduce((a, r) => a + r.billedMinor, 0),
        paidMinor: data.reduce((a, r) => a + r.paidMinor, 0),
      },
    };
  }
  if (module === "SEO_RANKINGS") {
    const keywords = await db.keyword.findMany({
      where: { orgId },
      include: { snapshots: { where: { capturedOn: { gte: since } }, orderBy: { capturedOn: "asc" } } },
    });
    const rows = keywords
      .filter((k) => k.snapshots.length > 0)
      .map((k) => ({
        term: k.term,
        device: k.device,
        from: k.snapshots[0].position,
        to: k.snapshots[k.snapshots.length - 1].position,
        delta: k.snapshots[0].position - k.snapshots[k.snapshots.length - 1].position,
      }));
    return {
      columns: [
        { key: "term", label: "Keyword", type: "text" },
        { key: "device", label: "Device", type: "text" },
        { key: "from", label: "Position (start)", type: "number" },
        { key: "to", label: "Position (latest)", type: "number" },
        { key: "delta", label: "Improvement", type: "number" },
      ],
      rows,
      summary: { keywords: rows.length, improved: rows.filter((r) => r.delta > 0).length },
    };
  }
  if (module === "CAMPAIGNS") {
    const rows = await db.campaign.findMany({
      where: { orgId, ...(clientId ? { clientId } : {}) },
      include: { channel: { select: { name: true } }, metrics: { where: { date: { gte: since } } } },
    });
    const data = rows.map((c) => ({
      name: c.name,
      channel: c.channel?.name ?? "—",
      costMinor: Number(c.metrics.reduce((a, m) => a + m.costMinor, 0n)),
      revenueMinor: Number(c.metrics.reduce((a, m) => a + m.revenueMinor, 0n)),
      clicks: Number(c.metrics.reduce((a, m) => a + m.clicks, 0n)),
      conversions: Number(c.metrics.reduce((a, m) => a + m.conversions, 0n)),
    }));
    return {
      columns: [
        { key: "name", label: "Campaign", type: "text" },
        { key: "channel", label: "Channel", type: "text" },
        { key: "costMinor", label: "Cost (minor)", type: "money" },
        { key: "revenueMinor", label: "Revenue (minor)", type: "money" },
        { key: "clicks", label: "Clicks", type: "number" },
        { key: "conversions", label: "Conversions", type: "number" },
      ],
      rows: data,
      summary: {
        costMinor: data.reduce((a, r) => a + r.costMinor, 0),
        revenueMinor: data.reduce((a, r) => a + r.revenueMinor, 0),
      },
    };
  }
  if (module === "TIMESHEETS") {
    const grouped = await db.timeEntry.groupBy({
      by: ["userId"],
      where: { orgId, date: { gte: since }, ...(clientId ? { project: { clientId } } : {}) },
      _sum: { minutes: true },
    });
    const users = await db.user.findMany({ where: { id: { in: grouped.map((g) => g.userId) } }, select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const rows = grouped.map((g) => ({ member: nameById.get(g.userId) ?? "Unknown", minutes: g._sum.minutes ?? 0 }));
    return {
      columns: [
        { key: "member", label: "Member", type: "text" },
        { key: "minutes", label: "Billable minutes", type: "number" },
      ],
      rows,
      summary: { totalMinutes: rows.reduce((a, r) => a + r.minutes, 0) },
    };
  }
  // TEAM activity
  const acts = await db.activityLog.groupBy({
    by: ["userId"],
    where: { orgId, createdAt: { gte: since } },
    _count: true,
  });
  const users = await db.user.findMany({ where: { id: { in: acts.map((a) => a.userId ?? "").filter(Boolean) } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const rows = acts.map((a) => ({
    member: a.userId ? nameById.get(a.userId) ?? "Unknown" : "system",
    actions: a._count,
  }));
  return {
    columns: [
      { key: "member", label: "Member", type: "text" },
      { key: "actions", label: "Actions", type: "number" },
    ],
    rows,
    summary: { totalActions: rows.reduce((a, r) => a + r.actions, 0) },
  };
}

export async function previewReport(ctx: Ctx, input: unknown): Promise<ReportResult> {
  const data = reportSchema.omit({ name: true, schedule: true }).parse(input);
  await assertFeature(ctx.orgId, "REPORT_BUILDER");
  const since = monthsBack(data.definition.months);
  return computeReport(ctx.orgId, data.module as ReportModule, since, data.definition.clientId ?? null);
}

export async function listActivity(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const entityTypeRaw = query.get("entityType");
  const entityId = query.get("entityId");
  const entityType = z
    .enum(["CLIENT", "LEAD", "PROJECT", "TASK", "INVOICE", "QUOTE", "CAMPAIGN", "SUBSCRIPTION"])
    .safeParse(entityTypeRaw);
  const where = {
    orgId: ctx.orgId,
    ...(entityType.success && entityId ? { entityType: entityType.data, entityId } : {}),
    ...(p.q ? { action: { contains: p.q } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      ...skipTake(p),
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    }),
    db.activityLog.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}
