// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { checkoutClientInvoice } from "@/server/services/billing.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/invoices/[id]/checkout">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "invoice.collect" },
    async ({ viewer, ip }) => {
      const data = await checkoutClientInvoice(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
