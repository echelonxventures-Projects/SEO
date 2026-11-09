import { AppError, ErrorCodes } from "../errors";
import type { PublishInput, PublishResult, SocialAppCreds, SocialProviderAdapter, TokenBundle } from "./types";
import { guardedFetch as fetch } from "../net-guard"; // SSRF-guarded: workspace-controlled URLs

export const DEFAULT_API = "https://api.x.com/2";
export const DEFAULT_AUTHORIZE = "https://x.com/i/oauth2/authorize";
export const DEFAULT_TOKEN = "https://x.com/i/oauth2/token";

function api(creds: Pick<SocialAppCreds, "apiBase">): string {
  return (creds.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
}

/**
 * X (Twitter) adapter — OAuth 2.0 PKCE + v2 tweet creation. All three hosts
 * (authorize / token / api) are overridable per workspace configuration.
 */
export const xProvider: SocialProviderAdapter = {
  key: "x",
  capabilities: ["publish"],
  label: "X (Twitter)",

  authorizeUrl(creds, state, redirectUri, pkce) {
    if (!pkce?.challenge) throw new AppError(ErrorCodes.INTERNAL, "X requires a PKCE challenge");
    const p = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: creds.scopes.join(" "),
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
    const base = creds.authorizeUrl ?? DEFAULT_AUTHORIZE;
    return `${base}${base.includes("?") ? "&" : "?"}${p}`;
  },

  async exchangeCode(creds, code, redirectUri, verifier): Promise<TokenBundle> {
    if (!verifier) throw new AppError(ErrorCodes.VALIDATION, "X requires PKCE — re-start the connection");
    const res = await fetch(creds.tokenUrl ?? DEFAULT_TOKEN, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
        ...(creds.headers ?? {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !json.access_token) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `X token exchange failed (${res.status})`);
    }
    const me = await fetch(`${api(creds)}/users/me`, {
      headers: { authorization: `Bearer ${json.access_token}`, ...(creds.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
      .then((r) => r.json().catch(() => ({})))
      .catch(() => ({})) as { data?: { id?: string; username?: string } };
    if (!me.data?.id) throw new AppError(ErrorCodes.GATEWAY_ERROR, "X: could not read connected user");
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      externalAccountId: me.data.id,
      handle: `@${me.data.username ?? me.data.id}`,
      displayName: me.data.username ?? null,
    };
  },

  async publish(input): Promise<PublishResult> {
    const API = (input.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
    const res = await fetch(`${API}/tweets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
        ...(input.headers ?? {}),
      },
      body: JSON.stringify({ text: input.text.slice(0, 280) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; errors?: { message?: string }[] };
    if (!res.ok || !json.data?.id) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `X publish failed: ${json.errors?.[0]?.message ?? res.status}`);
    }
    return { externalId: json.data.id };
  },

  async refresh(creds, refreshToken): Promise<{ accessToken: string; expiresAt: Date } | null> {
    const res = await fetch(creds.tokenUrl ?? DEFAULT_TOKEN, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
        ...(creds.headers ?? {}),
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) return null;
    return {
      accessToken: json.access_token,
      expiresAt: new Date(Date.now() + (json.expires_in ?? 7200) * 1000),
    };
  },
};
