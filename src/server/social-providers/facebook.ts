import { AppError, ErrorCodes } from "../errors";
import { graphVersion } from "./types";
import type { PublishInput, PublishResult, SocialAppCreds, SocialProviderAdapter, TokenBundle } from "./types";

export const DEFAULT_GRAPH = `https://graph.facebook.com/${graphVersion()}`;
export const DEFAULT_AUTHORIZE = `https://www.facebook.com/${graphVersion()}/dialog/oauth`;

function graph(creds: Pick<SocialAppCreds, "apiBase">): string {
  return (creds.apiBase ?? DEFAULT_GRAPH).replace(/\/+$/, "");
}

async function fbJson(url: string, init?: RequestInit, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error) {
    const msg = typeof (json.error as { message?: string } | undefined)?.message === "string" ? (json.error as { message: string }).message : `Graph error ${res.status}`;
    throw new AppError(ErrorCodes.GATEWAY_ERROR, `Facebook: ${msg}`);
  }
  return json;
}

/**
 * Facebook Pages adapter. Every URL is overridable through SocialAppConfig
 * (authorizeUrl / apiBase); the constants below are provider protocol
 * defaults, applied only when the workspace left the blanks empty.
 */
export const facebookProvider: SocialProviderAdapter = {
  key: "facebook",
  capabilities: ["publish","read_metrics"],
  label: "Facebook Pages",

  authorizeUrl(creds, state, redirectUri) {
    const p = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      state,
      scope: creds.scopes.join(","),
      response_type: "code",
    });
    const base = creds.authorizeUrl ?? DEFAULT_AUTHORIZE;
    return `${base}${base.includes("?") ? "&" : "?"}${p}`;
  },

  async exchangeCode(creds, code, redirectUri): Promise<TokenBundle> {
    const GRAPH = graph(creds);
    const tokenExchange = creds.tokenUrl ?? `${GRAPH}/oauth/access_token`;
    const qs = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, code });
    const short = await fbJson(`${tokenExchange}?${qs}`, undefined, creds.headers);
    if (typeof short.access_token !== "string") throw new AppError(ErrorCodes.GATEWAY_ERROR, "Facebook: no token returned");
    const long = await fbJson(
      `${tokenExchange}?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        fb_exchange_token: short.access_token,
      })}`,
      undefined,
      creds.headers,
    );
    const userToken = typeof long.access_token === "string" ? long.access_token : short.access_token;
    const expiresAt = typeof long.expires_in === "number" ? new Date(Date.now() + long.expires_in * 1000) : null;
    const accounts = (await fbJson(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(userToken)}`, undefined, creds.headers)).data;
    const pages = Array.isArray(accounts) ? (accounts as Record<string, unknown>[]) : [];
    const page = pages[0];
    if (!page || typeof page.id !== "string" || typeof page.access_token !== "string") {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Facebook: account has no manageable Page");
    }
    return {
      accessToken: page.access_token,
      expiresAt,
      externalAccountId: page.id,
      handle: typeof page.name === "string" ? page.name : `page-${String(page.id).slice(-6)}`,
      displayName: typeof page.name === "string" ? page.name : null,
    };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const GRAPH = (input.apiBase ?? DEFAULT_GRAPH).replace(/\/+$/, "");
    const body = new URLSearchParams({ message: input.text, access_token: input.accessToken });
    if (input.linkUrl) body.set("link", input.linkUrl);
    const res = await fbJson(
      `${GRAPH}/${encodeURIComponent(input.externalAccountId)}/feed`,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
      input.headers,
    );
    return {
      externalId: String(res.id ?? ""),
      url: res.id ? `https://facebook.com/${input.externalAccountId}/posts/${String(res.id).split("_").pop()}` : null,
    };
  },
};
