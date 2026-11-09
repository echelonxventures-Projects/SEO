import type { NextRequest } from "next/server";
import { z } from "zod";
import { route, readJson, AppError, ErrorCodes, invalidateMaintenanceCache } from "@/server/api";
import { ok } from "@/server/serialize";
import { db } from "@/server/db";
import { requireAuth } from "@/server/context";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const row = await db.systemSetting.findUnique({ where: { key: "maintenance" } });
  const m = (row?.value as { on?: boolean; message?: string } | undefined) ?? {};
  return ok({ on: Boolean(m.on), message: m.on ? (m.message ?? "Scheduled maintenance") : null });
}

export async function POST(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer, ip }) => {
    requireAuth(viewer);
    if (!viewer!.isPlatformAdmin) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Platform operators control maintenance mode");
    }
    const data = z.object({ on: z.boolean(), message: z.string().trim().max(240).default("") }).parse(await readJson(req));
    await db.systemSetting.upsert({
      where: { key: "maintenance" },
      create: { key: "maintenance", value: data },
      update: { value: data },
    });
    invalidateMaintenanceCache();
    await db.activityLog.create({ data: { action: "platform.maintenance", meta: data, userId: viewer!.userId, ip } });
    return ok(data);
  });
}
