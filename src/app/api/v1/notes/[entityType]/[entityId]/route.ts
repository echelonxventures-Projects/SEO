// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listNotes } from "@/server/services/crm.service";
import { noteEntityTypeSchema } from "@/server/services/crm.service";
import { createNote } from "@/server/services/crm.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/notes/[entityType]/[entityId]">,
): Promise<Response> {
  const { entityType, entityId } = await ctx.params;
  return route(
    req,
    { permission: "org.read" },
    async ({ viewer, ip }) => {
      const t = noteEntityTypeSchema.parse(entityType); const data = await listNotes(ctxOf(viewer!, ip), t, entityId);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/notes/[entityType]/[entityId]">,
): Promise<Response> {
  const { entityType, entityId } = await ctx.params;
  return route(
    req,
    { permission: "org.read" },
    async ({ viewer, ip }) => {
      const t = noteEntityTypeSchema.parse(entityType); await createNote(ctxOf(viewer!, ip), t, entityId, await readJson(req));
      return ok(null);
    },
  );
}
