import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { decryptSecret } from "../crypto";
import type { AiModelConfig, FeatureCode } from "@/generated/prisma/client";
import type { SubscriptionStatus } from "@/generated/prisma/client";
import { demoProvider } from "./demo";
import { openaiProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import type { AiProviderAdapter } from "./types";

const adapters: Record<string, AiProviderAdapter> = {
  [demoProvider.code]: demoProvider,
  [openaiProvider.code]: openaiProvider,
  [anthropicProvider.code]: anthropicProvider,
  [googleProvider.code]: googleProvider,
};

export function aiCredentialAad(cfg: Pick<AiModelConfig, "id" | "orgId" | "providerCode">): string {
  return `ai:${cfg.orgId ?? "platform"}:${cfg.providerCode}:${cfg.id}`;
}

export type AiCandidate = { cfg: AiModelConfig; apiKey: string; adapter: AiProviderAdapter };

export type AiCapability = "text" | "image" | "audio";

function supports(adapter: AiProviderAdapter, capability: AiCapability): boolean {
  if (capability === "text") return true;
  if (capability === "image") return Boolean(adapter.image);
  return Boolean(adapter.audio);
}

const BILLABLE_SUB_STATUSES: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"];

/**
 * The routing table for one capability, in attempt order:
 *   1. org-scoped configs beat platform defaults (workspace autonomy),
 *   2. then ascending `priority` (free engines are seeded with low numbers),
 *   3. a config with `requiredFeature` set is only eligible when the tenant's
 *      current plan includes that feature — so premium providers are reachable
 *      only by plans that carry them. No tier names live in code.
 */
export async function aiRouting(orgId: string, capability: AiCapability) {
  const configs = await db.aiModelConfig.findMany({
    where: { active: true, OR: [{ orgId }, { orgId: null }] },
  });
  const sub = await db.subscription.findFirst({
    where: { orgId, status: { in: BILLABLE_SUB_STATUSES } },
    orderBy: { createdAt: "desc" },
    include: { plan: { include: { features: { select: { featureCode: true } } } } },
  });
  const granted = new Set<string>((sub?.plan.features ?? []).map((f) => f.featureCode));

  const ordered = configs.sort((a, b) => {
    if ((a.orgId === null) !== (b.orgId === null)) return a.orgId === null ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const rows = ordered.map((cfg) => {
    const adapter = adapters[cfg.providerCode];
    let reason: string | null = null;
    let eligible = true;
    if (!adapter) {
      eligible = false;
      reason = "provider has no implemented adapter";
    } else if (!supports(adapter, capability)) {
      eligible = false;
      reason = `adapter does not support ${capability} generation`;
    } else if (cfg.requiredFeature && !granted.has(cfg.requiredFeature)) {
      eligible = false;
      reason = `requires plan feature ${cfg.requiredFeature}`;
    }
    return {
      id: cfg.id,
      providerCode: cfg.providerCode,
      label: cfg.label,
      scope: cfg.orgId ? ("ORGANIZATION" as const) : ("PLATFORM" as const),
      priority: cfg.priority,
      requiredFeature: cfg.requiredFeature,
      model: capability === "image" ? cfg.imageModel : capability === "audio" ? cfg.audioModel : cfg.textModel,
      eligible,
      reason,
    };
  });
  return { rows, granted };
}

export async function resolveAiCandidates(orgId: string, capability: AiCapability): Promise<AiCandidate[]> {
  const { rows, granted } = await aiRouting(orgId, capability);
  const eligible = rows.filter((r) => r.eligible);
  if (eligible.length === 0) {
    const blockedPremium = rows.find((r) => r.reason?.startsWith("requires plan feature"));
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      blockedPremium
        ? `No ${capability} AI provider available on your plan — upgrade for premium models, or ask the platform to configure a free-tier provider.`
        : `No active AI provider configured for ${capability} generation. Add one under Settings → AI Studio.`,
    );
  }
  const out: AiCandidate[] = [];
  for (const row of eligible) {
    const cfg = await db.aiModelConfig.findUniqueOrThrow({ where: { id: row.id } });
    const adapter = adapters[cfg.providerCode];
    void granted;
    const apiKey = decryptSecret(cfg.apiKeyEnc, aiCredentialAad(cfg));
    out.push({ cfg, apiKey, adapter });
  }
  return out;
}

export function listAiProviders() {
  return Object.values(adapters).map((a) => ({
    code: a.code,
    label: a.label,
    capabilities: {
      text: true,
      image: Boolean(a.image),
      audio: Boolean(a.audio),
    },
  }));
}
