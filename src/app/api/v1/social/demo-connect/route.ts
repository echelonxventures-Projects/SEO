// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { connectDemo } from "@/server/services/social.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "social.connect" },
    async ({ viewer, ip }) => {
      const data = await connectDemo(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}
