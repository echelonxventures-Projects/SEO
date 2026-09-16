import type { AiModelConfig } from "@/generated/prisma/client";
import { AppError, ErrorCodes } from "../errors";
import type { AiProviderAdapter, TextRequest, TextResult } from "./types";

/**
 * Google Gemini adapter (generateContent). Gemini offers a free API tier, so
 * platform seeders commonly register it with a low priority to serve all plans.
 * Text only; image/audio capabilities fall through to other candidates.
 */
export const googleProvider: AiProviderAdapter = {
  code: "google",
  label: "Google Gemini",

  async text(cfg: AiModelConfig, apiKey: string, req: TextRequest): Promise<TextResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.textModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `Gemini error ${res.status}`, (json.error?.message ?? "").slice(0, 1500));
    }
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return {
      text,
      tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};
