// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { checkoutTenantInvoice } from "@/server/services/billing.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/billing/invoices/[id]/checkout">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "subscription.manage" },
    async ({ viewer, ip }) => {
      const data = await checkoutTenantInvoice(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
