import { db } from "@/server/db";

export const dynamic = "force-dynamic";
const started = Date.now();

export async function GET(): Promise<Response> {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return Response.json(
    {
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  );
}
