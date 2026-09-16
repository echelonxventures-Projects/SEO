// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listPayments } from "@/server/services/sales.service";
import { recordPayment } from "@/server/services/sales.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "payment.read" },
    async ({ viewer, ip }) => {
      const data = await listPayments(ctxOf(viewer!, ip), req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "payment.write", idempotent: true },
    async ({ viewer, ip }) => {
      const data = await recordPayment(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
