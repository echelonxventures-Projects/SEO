import type { NextRequest } from "next/server";
import { route } from "@/server/api";
import { ctxOf } from "@/server/services/common";
import { db } from "@/server/db";
import { jsonSafe } from "@/server/serialize";

export const dynamic = "force-dynamic";

const CAP = 1000;

/** Full workspace data export (GDPR/portability): every org-owned table. */
export async function GET(req: NextRequest): Promise<Response> {
  return route(req, { permission: "org.update" }, async ({ viewer, ip }) => {
    const { orgId } = ctxOf(viewer!, ip);
    const where = { orgId } as const;
    const take = { take: CAP };
    const [
      organization, clients, contacts, leads, projects, tasks, timeEntries, expenses,
      serviceItems, quotes, invoices, payments, refunds, keywords, rankSnapshots,
      backlinks, siteAudits, campaigns, campaignMetrics, contentPosts, trackedLinks,
      webProperties, mailingLists, subscribers, emailCampaigns, tags, notes,
      documentSequences, pipelineStages, brandVoices, subscriptions, activity,
      calendars, temporalPatterns, scheduledEvents, eventOccurrences, appointments,
      appointmentSlots, resources, resourceBookings, availabilityProfiles, shifts,
      shiftAssignments, temporalTriggers, temporalEventLog, temporalConfiguration,
    ] = await Promise.all([
      db.organization.findUnique({ where: { id: orgId } }),
      db.client.findMany({ where, ...take }),
      db.contact.findMany({ where: { client: where }, ...take }),
      db.lead.findMany({ where, ...take }),
      db.project.findMany({ where, ...take }),
      db.task.findMany({ where, ...take }),
      db.timeEntry.findMany({ where, ...take }),
      db.expense.findMany({ where, ...take }),
      db.serviceItem.findMany({ where, ...take }),
      db.quote.findMany({ where, include: { lines: true }, ...take }),
      db.invoice.findMany({ where, include: { lines: true }, ...take }),
      db.payment.findMany({ where, ...take }),
      db.refund.findMany({ where, ...take }),
      db.keyword.findMany({ where, ...take }),
      db.rankSnapshot.findMany({ where, ...take }),
      db.backlink.findMany({ where, ...take }),
      db.siteAudit.findMany({ where, include: { issues: true }, ...take }),
      db.campaign.findMany({ where, ...take }),
      db.campaignMetric.findMany({ where, ...take }),
      db.contentPost.findMany({ where, include: { targets: true }, ...take }),
      db.trackedLink.findMany({ where, ...take }),
      db.webProperty.findMany({ where, include: { pixels: true }, ...take }),
      db.mailingList.findMany({ where, ...take }),
      db.subscriber.findMany({ where, ...take }),
      db.emailCampaign.findMany({ where, ...take }),
      db.tag.findMany({ where, include: { linked: true }, ...take }),
      db.note.findMany({ where, ...take }),
      db.documentSequence.findMany({ where }),
      db.pipelineStage.findMany({ where }),
      db.brandVoice.findMany({ where }),
      db.subscription.findMany({ where, include: { cycles: true } }),
      db.activityLog.findMany({ where, ...take }),
      db.calendar.findMany({ where, ...take }),
      db.temporalPattern.findMany({ where, ...take }),
      db.scheduledEvent.findMany({ where, ...take }),
      db.eventOccurrence.findMany({ where, ...take }),
      db.appointment.findMany({ where, ...take }),
      db.appointmentSlot.findMany({ where, ...take }),
      db.resource.findMany({ where, ...take }),
      db.resourceBooking.findMany({ where, ...take }),
      db.availabilityProfile.findMany({ where, ...take }),
      db.shift.findMany({ where, ...take }),
      db.shiftAssignment.findMany({ where, ...take }),
      db.temporalTrigger.findMany({ where, ...take }),
      db.temporalEventLog.findMany({ where, ...take }),
      db.temporalConfiguration.findMany({ where }),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      counts: {
        clients: clients.length, projects: projects.length, invoices: invoices.length,
        payments: payments.length, snapshots: rankSnapshots.length,
      },
      data: {
        organization, clients, contacts, leads, projects, tasks, timeEntries, expenses,
        serviceItems, quotes, invoices, payments, refunds, keywords, rankSnapshots,
        backlinks, siteAudits, campaigns, campaignMetrics, contentPosts, trackedLinks,
        webProperties, mailingLists, subscribers, emailCampaigns, tags, notes,
        documentSequences, pipelineStages, brandVoices, subscriptions: subscriptionSummary(subscriptions), activity,
        calendars, temporalPatterns, scheduledEvents, eventOccurrences, appointments,
        appointmentSlots, resources, resourceBookings, availabilityProfiles, shifts,
        shiftAssignments, temporalTriggers, temporalEventLog, temporalConfiguration,
      },
    };
    const filename = `omnimark-export-${orgId}-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(jsonSafe(payload)), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}

function subscriptionSummary(subs: Awaited<ReturnType<typeof db.subscription.findMany>>) {
  return subs.map((s) => ({
    ...s,
    gatewayHints: undefined,
  }));
}
