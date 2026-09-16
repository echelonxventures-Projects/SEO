// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listProjects } from "@/server/services/delivery.service";
import { createProject } from "@/server/services/delivery.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "project.read" },
    async ({ viewer, ip }) => {
      const data = await listProjects(ctxOf(viewer!, ip), req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "project.write" },
    async ({ viewer, ip }) => {
      const data = await createProject(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
