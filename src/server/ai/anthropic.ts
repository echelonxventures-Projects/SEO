import type { AiModelConfig } from "@/generated/prisma/client";
import { AppError, ErrorCodes } from "../errors";
import type { AiProviderAdapter, TextRequest, TextResult } from "./types";

/**
 * Anthropic Messages API adapter (text). Anthropic has no image/audio
 * generation on this surface — image/audio kinds fall back per the registry.
 */
export const anthropicProvider: AiProviderAdapter = {
  code: "anthropic",
  label: "Anthropic Claude",

  async text(_cfg: AiModelConfig, apiKey: string, req: TextRequest): Promise<TextResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: _cfg.textModel,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `Anthropic error ${res.status}`, t.slice(0, 1500));
    }
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    return {
      text,
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
    };
  },
};
