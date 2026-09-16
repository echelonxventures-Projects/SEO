// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deletePayment } from "@/server/services/sales.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/payments/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "payment.write" },
    async ({ viewer, ip }) => {
      await deletePayment(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
