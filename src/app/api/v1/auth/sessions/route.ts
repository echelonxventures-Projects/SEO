import type { NextRequest } from "next/server";
import { z } from "zod";
import { route, readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { listMySessions, revokeMySessions } from "@/server/services/auth.service";
import { SESSION_COOKIE } from "@/server/sessions";
import { sha256 } from "@/server/crypto";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer }) => {
    const data = await listMySessions(viewer!.userId);
    return ok(data);
  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const current = token ? await db.session.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  return route(req, { auth: "required" }, async ({ viewer }) => {
    const body = z.object({ allOthers: z.boolean().default(true) }).parse(await readJson(req).catch(() => ({ allOthers: true })));
    await revokeMySessions(viewer!.userId, current?.id ?? null, body.allOthers);
    return ok(null);
  });
}
