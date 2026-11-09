import type { Ctx } from "./common";
import { CONSTITUTION } from "../constitution";
import { createSubscription, listEvents, listSubscriptions, recentDeliveries, toggleSubscription, type EmitInput } from "../events";

export async function registryDoc() {
  return CONSTITUTION;
}

export async function listEventsApi(ctx: Ctx, type?: string) {
  return listEvents(ctx.orgId, type);
}

export async function listSubsApi(ctx: Ctx) {
  return listSubscriptions(ctx.orgId, ctx.viewer.isPlatformAdmin);
}

export async function createSubApi(ctx: Ctx, input: unknown) {
  const { z } = await import("zod");
  const data = z.object({ eventMatch: z.string().min(1).max(80), url: z.string().url().max(600), label: z.string().trim().min(2).max(80) }).parse(input);
  return createSubscription({ orgId: ctx.orgId, ...data });
}

export async function toggleSubApi(ctx: Ctx, id: string, active: boolean) {
  await toggleSubscription(ctx.orgId, id, active, ctx.viewer.isPlatformAdmin);
}

export async function deliveriesApi(ctx: Ctx, subscriptionId: string) {
  return recentDeliveries(ctx.orgId, subscriptionId, ctx.viewer.isPlatformAdmin);
}

export type { EmitInput };
