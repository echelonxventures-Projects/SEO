// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listLeads } from "@/server/services/crm.service";
import { createLead } from "@/server/services/crm.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "lead.read" },
    async ({ viewer, ip }) => {
      const data = await listLeads(ctxOf(viewer!, ip), req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "lead.write" },
    async ({ viewer, ip }) => {
      const data = await createLead(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
