import { AppError, ErrorCodes } from "../errors";
import type { PublishInput, PublishResult, SocialAppCreds, SocialProviderAdapter, TokenBundle } from "./types";

export const DEFAULT_AUTHORIZE = "https://www.linkedin.com/oauth/v2/authorization";
export const DEFAULT_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
export const DEFAULT_API = "https://api.linkedin.com";

function api(creds: Pick<SocialAppCreds, "apiBase">): string {
  return (creds.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
}

/**
 * LinkedIn adapter — OAuth + Share (UGC) API, posting as the member.
 * Versioned endpoints (`LinkedIn-Version` header, api host) are configuration:
 * set `apiBase` / `headers` on the workspace's SocialAppConfig to pin or
 * upgrade without touching this file.
 */
export const linkedinProvider: SocialProviderAdapter = {
  key: "linkedin",
  capabilities: ["publish"],
  label: "LinkedIn",

  authorizeUrl(creds, state, redirectUri) {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      state,
      scope: creds.scopes.join(" "),
    });
    const base = creds.authorizeUrl ?? DEFAULT_AUTHORIZE;
    return `${base}${base.includes("?") ? "&" : "?"}${p}`;
  },

  async exchangeCode(creds, code, redirectUri): Promise<TokenBundle> {
    const res = await fetch(creds.tokenUrl ?? DEFAULT_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(creds.headers ?? {}) },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `LinkedIn token exchange failed (${res.status})`);
    }
    const me = (await fetch(`${api(creds)}/v2/userinfo`, {
      headers: { authorization: `Bearer ${json.access_token}`, ...(creds.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
      .then((r) => r.json())
      .catch(() => ({}))) as { sub?: string; name?: string; picture?: string };
    if (!me.sub) throw new AppError(ErrorCodes.GATEWAY_ERROR, "LinkedIn: could not read member id");
    return {
      accessToken: json.access_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      externalAccountId: me.sub,
      handle: me.name ?? `member-${me.sub.slice(-6)}`,
      displayName: me.name ?? null,
      pictureUrl: me.picture ?? null,
    };
  },

  async publish(input): Promise<PublishResult> {
    const API = (input.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
    const versionHeader = input.headers?.["LinkedIn-Version"] ?? "202506";
    const body: Record<string, unknown> = {
      author: `urn:li:person:${input.externalAccountId}`,
      commentary: input.text.slice(0, 3000),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN", targetAudiences: ["urn:li:fs_targetVisibility:PUBLIC"] },
    };
    if (input.linkUrl) {
      body.content = {
        title: input.linkUrl.slice(0, 140),
        featured: { id: input.linkUrl, originalUrl: input.linkUrl },
      };
    }
    const res = await fetch(`${API}/rest/posts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
        "LinkedIn-Version": versionHeader,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `LinkedIn publish failed (${res.status})`, t.slice(0, 500));
    }
    const id = res.headers.get("x-restli-id") ?? "";
    return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/urn:li:share:${id}/` : null };
  },
};
