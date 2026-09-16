import { requirePageViewer } from "@/server/pages";
import { db } from "@/server/db";
import { SettingsClient } from "./settings-client";
import { headers } from "next/headers";
import { ctxOf } from "@/server/services/common";
import { getBillingState } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requirePageViewer();
  const ctx = ctxOf(viewer, (await headers()).get("x-forwarded-for"));
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.orgId },
    select: {
      name: true, slug: true, email: true, phone: true, website: true, gstin: true,
      taxIdType: true, addressLine1: true, addressLine2: true, city: true, state: true,
      postalCode: true, country: true, timezone: true, locale: true, defaultCurrencyCode: true, logoUrl: true, billingEmail: true,
    },
  });
  const billing = await getBillingState(ctx);
  return (
    <SettingsClient
      org={org}
      permissions={[...viewer.active!.permissions]}
      canManagePlatform={viewer.isPlatformAdmin}
      activeCurrency={org.defaultCurrencyCode}
      hasSubscription={!!billing.subscription}
    />
  );
}
