import type { AiModelConfig } from "@/generated/prisma/client";

export type TextRequest = {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
};

export type TextResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};

export type ImageRequest = { prompt: string; size: string };
export type ImageResult = { url: string };

export type AudioRequest = { text: string; voice: string };
export type AudioResult = { url: string };

/**
 * AI provider contract. Configs are resolved from the database (org override →
 * platform default); the decrypted API key is passed per-call only and must
 * never be persisted or logged.
 */
export interface AiProviderAdapter {
  code: "openai" | "anthropic" | "google" | "demo";
  label: string;
  text(cfg: AiModelConfig, apiKey: string, req: TextRequest): Promise<TextResult>;
  image?(cfg: AiModelConfig, apiKey: string, req: ImageRequest): Promise<ImageResult>;
  audio?(cfg: AiModelConfig, apiKey: string, req: AudioRequest): Promise<AudioResult>;
}
