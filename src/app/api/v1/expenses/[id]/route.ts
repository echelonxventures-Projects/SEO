// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { updateExpense } from "@/server/services/delivery.service";
import { deleteExpense } from "@/server/services/delivery.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/expenses/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "expense.write" },
    async ({ viewer, ip }) => {
      const data = await updateExpense(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/expenses/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "expense.delete" },
    async ({ viewer, ip }) => {
      await deleteExpense(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
