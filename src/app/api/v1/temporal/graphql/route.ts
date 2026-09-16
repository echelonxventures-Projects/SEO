// Hand-written GraphQL gateway — returns the spec-shaped { data } envelope
// (not the REST { data } wrapper), read-only, RBAC-guarded.
import type { NextRequest } from "next/server";
import { route, readJson } from "@/server/api";
import { ctxOf } from "@/server/services/common";
import { graphql } from "@/server/services/temporal-sdk.service";

export async function POST(req: NextRequest): Promise<Response> {
  return route(req, { permission: "temporal.read" }, async ({ viewer, ip }) => {
    const result = await graphql(ctxOf(viewer!, ip), await readJson(req));
    return Response.json(result, { status: 200 });
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return route(req, { permission: "temporal.read" }, async ({ viewer, ip }) => {
    const result = await graphql(ctxOf(viewer!, ip), { query: "{ calendars patterns triggers resources }" });
    return Response.json(result, { status: 200 });
  });
}
