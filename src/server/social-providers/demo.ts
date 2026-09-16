import { AppError, ErrorCodes } from "../errors";
import type { PublishInput, PublishResult, SocialProviderAdapter, TokenBundle } from "./types";

const POSTS = new Map<string, { text: string; at: number }>();

/**
 * DEMO network — instant "connection" (no OAuth), publishes recorded in
 * process memory + returned ids, clearly labelled everywhere. Lets the whole
 * scheduling pipeline run offline and be smoke-tested without external apps.
 */
export const demoProvider: SocialProviderAdapter = {
  key: "demo",
  capabilities: ["publish","read_metrics"],
  label: "Demo channel (sandbox)",

  authorizeUrl() {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Demo connections are created directly, no OAuth needed");
  },

  async exchangeCode(): Promise<TokenBundle> {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Demo connections are created directly, no OAuth needed");
  },

  async publish({ externalAccountId, text }: PublishInput): Promise<PublishResult> {
    const id = `demo_post_${Date.now().toString(36)}${POSTS.size.toString(36)}`;
    POSTS.set(id, { text: text.slice(0, 400), at: Date.now() });
    return { externalId: id, url: `https://demo.social.local/${externalAccountId}/${id}` };
  },
};

export function demoPost(id: string) {
  return POSTS.get(id) ?? null;
}
