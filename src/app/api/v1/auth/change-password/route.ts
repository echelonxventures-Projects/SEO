import type { NextRequest } from "next/server";
import { route, readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { clientIp } from "@/server/audit";
import { changePassword } from "@/server/services/auth.service";
import { clearAuthCookies } from "@/server/sessions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer, ip }) => {
    const body = await readJson(req);
    await changePassword(viewer!.userId, (body as { currentPassword: string }).currentPassword, (body as { newPassword: string }).newPassword, ip);
    await clearAuthCookies();
    return ok({ rotated: true, note: "All sessions revoked — sign in again" });
  });
}
