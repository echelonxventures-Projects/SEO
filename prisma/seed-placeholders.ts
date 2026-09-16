/**
 * Production "fill in the blank" placeholders.
 *
 * Every external service gets an INACTIVE row seeded with an obviously-fake
 * value (REPLACE-…). Nothing is ever used while inactive; go-live means:
 * open the Settings screen, replace the blank, activate. Keys are encrypted
 * at rest with the same envelope scheme as real configs.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encryptSecret } from "../src/server/crypto";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const PLACEHOLDER = "REPLACE-ME";

export async function seedPlaceholders() {
  // Gateways (platform scope) — Razorpay + Stripe blanks; mock stays the active demo
  const gateways = [
    { providerCode: "razorpay", label: "Razorpay (fill keys, then activate)", keyId: `${PLACEHOLDER}-rzp-key-id`, secret: `${PLACEHOLDER}-rzp-key-secret` },
    { providerCode: "stripe", label: "Stripe (fill keys, then activate)", keyId: `${PLACEHOLDER}-pk-publishable`, secret: `${PLACEHOLDER}-sk-secret` },
  ];
  for (const g of gateways) {
    const aad = `gateway:PLATFORM:platform:${g.providerCode}`;
    const existing = await db.gatewayConfig.findFirst({ where: { orgId: null, providerCode: g.providerCode } });
    const enc = encryptSecret(JSON.stringify({ keyId: g.keyId, keySecret: g.secret }), aad);
    if (existing) {
      await db.gatewayConfig.update({ where: { id: existing.id }, data: { label: g.label } });
    } else {
      await db.gatewayConfig.create({
        data: { orgId: null, scope: "PLATFORM", providerCode: g.providerCode, mode: "SANDBOX", label: g.label, credentialEnc: enc, publicMeta: { keyId: g.keyId, placeholder: true }, active: false },
      });
    }
  }

  // AI providers (platform scope) — inactive blanks unless env keys supplied real values
  const ais = [
    { providerCode: "google", label: "Google Gemini — free tier (fill key, activate)", key: `${PLACEHOLDER}-google-key`, textModel: "gemini-2.5-flash", imageModel: "gemini-2.5-flash-image", priority: 10 },
    { providerCode: "openai", label: "OpenAI / Groq / OpenRouter — premium (fill key, activate)", key: `${PLACEHOLDER}-openai-key`, textModel: "gpt-4o-mini", imageModel: "gpt-image-1", priority: 40, gated: "AI_PREMIUM" },
    { providerCode: "anthropic", label: "Anthropic Claude — premium (fill key, activate)", key: `${PLACEHOLDER}-anthropic-key`, textModel: "claude-sonnet-4-20250514", imageModel: "", priority: 50, gated: "AI_PREMIUM" },
  ];
  const envFor: Record<string, string> = { google: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
  for (const a of ais) {
    const existing = await db.aiModelConfig.findFirst({ where: { orgId: null, providerCode: a.providerCode } });
    if (existing) continue; // env-keyed rows from seed-marketing win if present
    void envFor[a.providerCode];
    const created = await db.aiModelConfig.create({
      data: {
        orgId: null,
        providerCode: a.providerCode,
        label: a.label,
        textModel: a.textModel,
        imageModel: a.imageModel,
        priority: a.priority,
        requiredFeature: a.gated as never ?? null,
        apiKeyEnc: encryptSecret(JSON.stringify({ apiKey: a.key }), "ai:pending"),
        active: false,
      },
    });
    await db.aiModelConfig.update({
      where: { id: created.id },
      data: { apiKeyEnc: encryptSecret(JSON.stringify({ apiKey: a.key }), `ai:platform:${a.providerCode}:${created.id}`) },
    });
  }

  // (Social app configs are org-scoped by design — the /social screen itself is the blank.)

  console.log("  [placeholders] gateway/AI blanks seeded (inactive). Open Settings to replace + activate.");
}
