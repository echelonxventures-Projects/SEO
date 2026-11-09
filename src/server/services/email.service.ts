import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { sendMail } from "../mail";
import { getEnv } from "../env";
import { signToken, verifyToken } from "../tokens";
import { emailSchema, nameish, urlish } from "../schemas";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";

const BATCH_PER_RUN = 40;
/** A claimed send older than this is assumed abandoned by a crashed run. */
const CLAIM_LEASE_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// Lists & subscribers
// ---------------------------------------------------------------------------

export async function createList(ctx: Ctx, input: unknown) {
  const data = z
    .object({
      name: nameish,
      description: z.string().trim().max(500).nullable().optional(),
      doubleOptIn: z.boolean().default(true),
      welcomeSubject: z.string().trim().max(200).nullable().optional(),
      welcomeBody: z.string().trim().max(5000).nullable().optional(),
    })
    .parse(input);
  await assertWritable(ctx.orgId);
  const list = await db.mailingList.create({ data: { orgId: ctx.orgId, ...data } });
  await audit(db, ctx, "emaillist.created", undefined, list.id, { name: list.name });
  return list;
}

export async function listLists(ctx: Ctx) {
  return db.mailingList.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { subscribers: true } } },
  });
}

export async function addSubscriber(ctx: Ctx, listId: string, input: unknown) {
  const data = z.object({ email: emailSchema, name: z.string().trim().max(120).nullable().optional() }).parse(input);
  const list = await requireOwned(await db.mailingList.findUnique({ where: { id: listId } }), "Mailing list", ctx.orgId);
  const existing = await db.subscriber.findUnique({ where: { listId_emailNormalized: { listId, emailNormalized: data.email } } });
  if (existing && existing.status === "SUBSCRIBED") {
    return { id: existing.id, status: existing.status };
  }
  const sub =
    existing ??
    (await db.subscriber.create({
      data: {
        listId,
        orgId: ctx.orgId,
        email: data.email,
        emailNormalized: data.email,
        name: data.name ?? null,
        status: "PENDING_CONFIRM",
        source: "manual",
      },
    }));
  if (!list.doubleOptIn) {
    await db.subscriber.update({
      where: { id: sub.id },
      data: { status: "SUBSCRIBED", subscribedAt: new Date() },
    });
    return { id: sub.id, status: "SUBSCRIBED" };
  }
  const token = signToken("email_optin", sub.id, 60 * 60 * 24 * 7);
  await sendMail({
    to: data.email,
    subject: `Confirm your subscription — ${list.name}`,
    text:
      `Please confirm your subscription to “${list.name}”:\n\n` +
      `${getEnv().APP_URL}/confirm/${encodeURIComponent(token)}\n\n` +
      `If you did not request this, ignore this email — nothing will be sent to you.`,
  });
  await audit(db, ctx, "subscriber.optin_sent", undefined, sub.id);
  return { id: sub.id, status: sub.status };
}

export async function confirmOptin(token: string): Promise<string> {
  const payload = verifyToken("email_optin", token);
  const sub = await db.subscriber.findUnique({ where: { id: payload.s }, include: { list: true } });
  if (!sub) throw new AppError(ErrorCodes.NOT_FOUND, "Subscription request not found");
  if (sub.status === "PENDING_CONFIRM") {
    await db.subscriber.update({ where: { id: sub.id }, data: { status: "SUBSCRIBED", subscribedAt: new Date() } });
    if (sub.list.welcomeSubject && sub.list.welcomeBody) {
      await sendMail({
        to: sub.email,
        subject: sub.list.welcomeSubject,
        text: sub.list.welcomeBody.replace(/\{\{name\}\}/g, sub.name ?? "there"),
      });
    }
  }
  return sub.emailNormalized;
}

/**
 * Idempotent unsubscribe. Only call this from a POST: the RFC 8058 one-click
 * endpoint (mail clients POST `List-Unsubscribe=One-Click`) or the confirm
 * button on /unsubscribe/[token]. Never on GET — mail security scanners
 * prefetch every link in a message and would unsubscribe the recipient.
 */
export async function unsubscribe(token: string): Promise<string> {
  const payload = verifyToken("email_unsub", token);
  const sub = await db.subscriber.findUnique({ where: { id: payload.s } });
  if (!sub) throw new AppError(ErrorCodes.NOT_FOUND, "Record not found");
  if (sub.status !== "UNSUBSCRIBED") {
    await db.subscriber.update({
      where: { id: sub.id },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    });
    await db.emailSend.updateMany({ where: { subscriberId: sub.id, status: "PENDING" }, data: { status: "FAILED", error: "unsubscribed" } });
  }
  return sub.emailNormalized;
}

export async function listSubscribers(ctx: Ctx, listId: string) {
  await requireOwned(await db.mailingList.findUnique({ where: { id: listId } }), "Mailing list", ctx.orgId);
  return db.subscriber.findMany({ where: { listId }, orderBy: { createdAt: "desc" }, take: 200 });
}

// ---------------------------------------------------------------------------
// Campaigns + dispatcher
// ---------------------------------------------------------------------------

export const emailCampaignSchema = z.object({
  listId: z.string().min(1),
  subject: z.string().trim().min(3).max(200),
  preheader: z.string().trim().max(200).nullable().optional(),
  bodyMarkdown: z.string().min(10).max(100_000),
  fromName: z.string().trim().max(120).nullable().optional(),
  fromEmail: emailSchema.nullable().optional(),
  clientId: z.string().max(64).nullable().optional(),
  campaignId: z.string().max(64).nullable().optional(),
});

export async function createEmailCampaign(ctx: Ctx, input: unknown) {
  const data = emailCampaignSchema.parse(input);
  await assertWritable(ctx.orgId);
  const list = await requireOwned(await db.mailingList.findUnique({ where: { id: data.listId } }), "Mailing list", ctx.orgId);
  if (data.campaignId) await requireOwned(await db.campaign.findUnique({ where: { id: data.campaignId } }), "Campaign", ctx.orgId);
  const campaign = await db.emailCampaign.create({
    data: {
      orgId: ctx.orgId,
      listId: list.id,
      subject: data.subject,
      preheader: data.preheader ?? null,
      bodyMarkdown: data.bodyMarkdown,
      fromName: data.fromName ?? null,
      fromEmail: data.fromEmail ?? null,
      clientId: data.clientId ?? null,
      campaignId: data.campaignId ?? null,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "emailcampaign.created", undefined, campaign.id, { subject: campaign.subject });
  return campaign;
}

export async function listEmailCampaigns(ctx: Ctx) {
  return db.emailCampaign.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { list: { select: { name: true, id: true } } },
    take: 50,
  });
}

export async function getEmailCampaign(ctx: Ctx, id: string) {
  return requireOwned(
    await db.emailCampaign.findUnique({
      where: { id },
      include: {
        list: { select: { name: true } },
        sends: { include: { subscriber: { select: { email: true, status: true } } }, orderBy: { id: "asc" }, take: 200 },
      },
    }),
    "Email campaign",
    ctx.orgId,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Minimal, safe markdown: escape first, then a tiny allowlist of transforms. */
export function renderEmailHtml(md: string): string {
  const escaped = escapeHtml(md);
  return escaped
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .split(/\n{2,}/)
    .map((block) => (/^<(h\d)>/.test(block.trim()) ? block : `<p>${block.replace(/\n/g, "<br/>")}</p>`))
    .join("\n");
}

export async function queueSend(ctx: Ctx, id: string, scheduledAt?: string | null) {
  const campaign = await requireOwned(
    await db.emailCampaign.findUnique({ where: { id }, include: { list: true } }),
    "Email campaign",
    ctx.orgId,
  );
  if (campaign.status !== "DRAFT") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Campaign is ${campaign.status.toLowerCase()}`);
  }
  const subs = await db.subscriber.findMany({
    where: { listId: campaign.listId, status: "SUBSCRIBED" },
    select: { id: true },
  });
  if (subs.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION, "The list has no confirmed subscribers to send to");
  }
  await db.$transaction(async (tx) => {
    await tx.emailSend.createMany({
      data: subs.map((s) => ({ campaignId: id, subscriberId: s.id })),
      skipDuplicates: true,
    });
    await tx.emailCampaign.update({
      where: { id },
      data: {
        status: scheduledAt ? "SCHEDULED" : "SENDING",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        queuedCount: subs.length,
      },
    });
    await audit(tx, ctx, scheduledAt ? "emailcampaign.scheduled" : "emailcampaign.queued", undefined, id, { recipients: subs.length });
  });
}

export async function cancelEmailCampaign(ctx: Ctx, id: string) {
  const campaign = await requireOwned(await db.emailCampaign.findUnique({ where: { id } }), "Email campaign", ctx.orgId);
  if (!["DRAFT", "SCHEDULED"].includes(campaign.status)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "A dispatched campaign cannot be cancelled");
  }
  await db.emailCampaign.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(db, ctx, "emailcampaign.cancelled", undefined, id);
}

export async function testEmailCampaign(ctx: Ctx, id: string) {
  const campaign = await requireOwned(
    await db.emailCampaign.findUnique({ where: { id }, include: { list: { select: { name: true, orgId: true } } } }),
    "Email campaign",
    ctx.orgId,
  );
  const unsubToken = signToken("email_unsub", "test-only", 60);
  await dispatchOne({ ...campaign, list: campaign.list }, {
    email: ctx.viewer.email,
    name: ctx.viewer.name,
    unsubToken,
    sendId: null,
  });
  await db.emailCampaign.update({ where: { id }, data: { testSentAt: new Date() } });
  await audit(db, ctx, "emailcampaign.test_sent", undefined, id);
}

async function dispatchOne(
  campaign: {
    subject: string;
    preheader: string | null;
    bodyMarkdown: string;
    fromName: string | null;
    fromEmail: string | null;
    list: { name: string; orgId: string };
  },
  to: { email: string; name: string | null; unsubToken: string; sendId: string | null },
): Promise<void> {
  const baseUrl = getEnv().APP_URL;
  const org = await db.organization.findUnique({
    where: { id: campaign.list.orgId },
    select: { name: true },
  });
  const from =
    campaign.fromEmail && campaign.fromName
      ? `${campaign.fromName} <${campaign.fromEmail}>`
      : campaign.fromEmail
        ? campaign.fromEmail
        : undefined;
  const tokenPart = encodeURIComponent(to.unsubToken);
  const unsubPage = `${baseUrl}/unsubscribe/${tokenPart}`;
  const unsubOneClick = `${baseUrl}/api/v1/public/unsubscribe/${tokenPart}`;
  const greeting = to.name ? escapeHtml(to.name) : "there";
  const html =
    `<!doctype html><html><body style="font-family:system-ui;max-width:560px;margin:auto;color:#18181b">` +
    (campaign.preheader ? `<div style="display:none">${escapeHtml(campaign.preheader)}</div>` : "") +
    renderEmailHtml(campaign.bodyMarkdown).replace(/Hi there,/, `Hi ${greeting},`) +
    (to.sendId ? `<img src="${baseUrl}/api/v1/public/email/open/${to.sendId}" width="1" height="1" alt="" style="display:none"/>` : "") +
    `<hr/><p style="font-size:12px;color:#71717a">You're receiving this because you subscribed to “${escapeHtml(campaign.list.name)}”` +
    (org ? ` by ${escapeHtml(org.name)}` : "") +
    `. <a href="${unsubPage}">Unsubscribe</a>.</p>` +
    `</body></html>`;
  await sendMail({
    to: to.email,
    subject: campaign.subject,
    text: `${campaign.bodyMarkdown}\n\n--\nUnsubscribe: ${unsubPage}`,
    html,
    from,
    // RFC 2369 + RFC 8058 one-click (required by Gmail/Yahoo for bulk senders)
    headers: {
      "List-Unsubscribe": `<${unsubOneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

/** Dispatcher run (cron): sends due campaigns' pending sends. */
export async function runEmailDispatcher(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const campaigns = await db.emailCampaign.findMany({
    where: {
      status: { in: ["SENDING", "SCHEDULED"] },
      OR: [{ status: "SENDING" }, { scheduledAt: { lte: new Date() } }],
    },
    take: 5,
    include: { list: { select: { name: true, orgId: true } } },
  });
  for (const campaign of campaigns) {
    if (campaign.status === "SCHEDULED") {
      await db.emailCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING", startedAt: new Date() } });
    }
    const sends = await db.emailSend.findMany({
      where: {
        campaignId: campaign.id,
        status: "PENDING",
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(Date.now() - CLAIM_LEASE_MS) } }],
      },
      take: BATCH_PER_RUN,
      include: { subscriber: true },
    });
    for (const send of sends) {
      // Atomic lease per send row: an overlapping run (second instance, manual
      // cron call) sees the fresh claimedAt and skips the row instead of re-sending.
      const now = new Date();
      const claim = await db.emailSend.updateMany({
        where: {
          id: send.id,
          status: "PENDING",
          OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - CLAIM_LEASE_MS) } }],
        },
        data: { attempts: { increment: 1 }, claimedAt: now },
      });
      if (claim.count === 0) continue;
      if (send.subscriber.status !== "SUBSCRIBED") {
        await db.emailSend.update({ where: { id: send.id }, data: { status: "FAILED", error: "subscriber not active" } });
        failed++;
        continue;
      }
      try {
        const unsubToken = signToken("email_unsub", send.subscriberId, 60 * 60 * 24 * 365);
        await dispatchOne(campaign, {
          email: send.subscriber.email,
          name: send.subscriber.name,
          unsubToken,
          sendId: send.id,
        });
        await db.emailSend.update({ where: { id: send.id }, data: { status: "SENT", sentAt: new Date() } });
        await db.emailCampaign.update({ where: { id: campaign.id }, data: { sentCount: { increment: 1 } } });
        sent++;
      } catch (e) {
        await db.emailSend.update({
          where: { id: send.id },
          data: { status: send.attempts + 1 >= 3 ? "FAILED" : "PENDING", claimedAt: null, error: (e instanceof Error ? e.message : "send failed").slice(0, 300) },
        });
        await db.emailCampaign.update({ where: { id: campaign.id }, data: { failedCount: { increment: 1 } } });
        failed++;
      }
    }
    const remaining = await db.emailSend.count({ where: { campaignId: campaign.id, status: "PENDING" } });
    if (remaining === 0) {
      await db.emailCampaign.update({ where: { id: campaign.id }, data: { status: "SENT", completedAt: new Date() } });
    }
  }
  return { sent, failed };
}

export async function markOpened(sendId: string): Promise<void> {
  const res = await db.emailSend.updateMany({
    where: { id: sendId, status: "SENT" },
    data: { status: "OPENED", openedAt: new Date() },
  });
  if (res.count > 0) {
    const send = await db.emailSend.findUnique({ where: { id: sendId }, select: { campaignId: true } });
    if (send) {
      await db.emailCampaign.update({ where: { id: send.campaignId }, data: { opensCount: { increment: 1 } } });
    }
  }
}
