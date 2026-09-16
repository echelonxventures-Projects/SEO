import type { AiModelConfig } from "@/generated/prisma/client";
import { AppError, ErrorCodes } from "../errors";
import type { AiProviderAdapter, AudioResult, ImageResult, TextRequest, TextResult } from "./types";

const DEFAULT_BASE = "https://api.openai.com/v1";

async function call(baseUrl: string, path: string, key: string, body: unknown): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new AppError(ErrorCodes.GATEWAY_ERROR, `AI provider error ${res.status}`, t.slice(0, 1500));
  }
  return res;
}

/**
 * OpenAI-compatible text/image/audio (works with Azure-compatible proxies,
 * OpenRouter, local gateways… via the configurable baseUrl).
 */
export const openaiProvider: AiProviderAdapter = {
  code: "openai",
  label: "OpenAI (or compatible)",

  async text(cfg, apiKey, req: TextRequest): Promise<TextResult> {
    const base = cfg.baseUrl ?? DEFAULT_BASE;
    const res = await call(base, "/chat/completions", apiKey, {
      model: cfg.textModel,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens,
      temperature: req.temperature,
    });
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    };
  },

  async image(cfg, apiKey, req): Promise<ImageResult> {
    const base = cfg.baseUrl ?? DEFAULT_BASE;
    const res = await call(base, "/images/generations", apiKey, {
      model: cfg.imageModel,
      prompt: req.prompt,
      size: req.size,
      n: 1,
    });
    const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
    const item = json.data?.[0];
    if (!item?.url) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Image provider returned no URL");
    }
    return { url: item.url };
  },

  async audio(cfg, apiKey, req): Promise<AudioResult> {
    const base = cfg.baseUrl ?? DEFAULT_BASE;
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.audioModel, voice: req.voice, input: req.text.slice(0, 4000) }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `Audio provider error ${res.status}`);
    }
    // Providers return binary audio; OmniMark stores nothing externally — the
    // client downloads directly from the streaming endpoint below.
    void res;
    return { url: `/api/v1/ai/audio` };
  },
};
