import type { NextRequest } from "next/server";
import { ok } from "@/server/serialize";
import { logout } from "@/server/services/auth.service";
import { clearAuthCookies, SESSION_COOKIE } from "@/server/sessions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  await logout(token);
  await clearAuthCookies();
  return ok(null);
}
