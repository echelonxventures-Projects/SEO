import { createHash } from "node:crypto";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { decryptSecret } from "../crypto";
import { facebookProvider } from "../social-providers/facebook";
import { xProvider } from "../social-providers/x";
import { linkedinProvider } from "../social-providers/linkedin";
import { demoProvider } from "../social-providers/demo";
import type {
  PublishInput,
  PublishResult,
  SocialAppCreds,
  SocialProviderAdapter,
  TokenBundle,
} from "../social-providers/types";

export type ConnectorTemplateRow = {
  id: string;
  key: string;
  name: string;
  protocol: "OAUTH2_CODE" | "OAUTH2_PKCE" | "BUILTIN";
  capabilities: string[];
  authorizeUrl: string | null;
  tokenUrl: string | null;
  apiBase: string | null;
  scopes: string[];
  config: Record<string, unknown>;
  builtin: boolean;
  orgId: string | null;
};

export function connectorAad(orgId: string, key: string): string {
  return `socialapp:${orgId}:${key}`;
}

/* ---------------------------- generic engine ----------------------------- */

function tplString(t: string, vars: Record<string, string>): string {
  return t.replace(/\{\{?(\w+)\}?\}/g, (_, k: string) => vars[k] ?? "");
}

function tplDeep(v: unknown, vars: Record<string, string>): unknown {
  if (typeof v === "string") return tplString(v, vars);
  if (Array.isArray(v)) return v.map((x) => tplDeep(x, vars));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = tplDeep(val, vars);
    return out;
  }
  return v;
}

function dig(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

type GenericCfg = {
  authStyle?: "basic" | "body";
  tokenExtra?: Record<string, unknown>;
  accessTokenPath?: string;
  refreshTokenPath?: string;
  expiresInPath?: string;
  tokenResponseRoot?: string;
  me?: { path: string; headers?: Record<string, string>; idPath: string; handlePath?: string; namePath?: string; picturePath?: string };
  publish: { path: string; headers?: Record<string, string>; body: Record<string, unknown>; idPath: string; urlPath?: string };
  refresh?: { body?: Record<string, unknown> };
  authorizeParams?: Record<string, unknown>;
};

export function genericAdapter(tpl: ConnectorTemplateRow): SocialProviderAdapter {
  const cfg = (tpl.config ?? {}) as GenericCfg;
  const base = (vars: { apiBase?: string | null }) =>
    ((vars.apiBase ?? tpl.apiBase) ?? "").replace(/\/+$/, "");

  const tokenCall = async (
    creds: SocialAppCreds,
    form: URLSearchParams,
  ): Promise<Record<string, unknown>> => {
    const url = creds.tokenUrl ?? tpl.tokenUrl;
    if (!url) throw new AppError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Connector ${tpl.key}: missing tokenUrl`);
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    const body = new URLSearchParams(form);
    if ((cfg.authStyle ?? "basic") === "basic") {
      headers.authorization = "Basic " + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    } else {
      body.set("client_id", creds.clientId);
      body.set("client_secret", creds.clientSecret);
    }
    for (const [k, v] of Object.entries((cfg.tokenExtra ?? {}) as Record<string, string>)) body.set(k, v);
    const res = await fetch(url, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const root = (cfg.tokenResponseRoot ? (dig(json, cfg.tokenResponseRoot) ?? json) : json) as Record<string, unknown>;
    if (!res.ok) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, `${tpl.key} token exchange failed (${res.status})`, JSON.stringify(json).slice(0, 400));
    }
    return root;
  };

  return {
    key: tpl.key,
    label: tpl.name,
    capabilities: tpl.capabilities,

    authorizeUrl(creds, state, redirectUri, pkce) {
      const url = creds.authorizeUrl ?? tpl.authorizeUrl;
      if (!url) throw new AppError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Connector ${tpl.key}: missing authorizeUrl`);
      const vars: Record<string, string> = {
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        state,
        scope: creds.scopes.join(tpl.config.scopeSeparator === " " ? " " : ","),
        code_challenge: pkce?.challenge ?? "",
        code_challenge_method: pkce ? "S256" : "",
        response_type: "code",
      };
      const p = new URLSearchParams(
        Object.fromEntries(
          Object.entries({ ...vars, ...((cfg.authorizeParams ?? {}) as Record<string, string>) })
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, tplString(String(v), vars)]),
        ),
      );
      return `${url}${url.includes("?") ? "&" : "?"}${p}`;
    },

    async exchangeCode(creds, code, redirectUri, verifier): Promise<TokenBundle> {
      const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      if (tpl.protocol === "OAUTH2_PKCE") {
        if (!verifier) throw new AppError(ErrorCodes.VALIDATION, "This connector requires PKCE — restart the connection");
        form.set("code_verifier", verifier);
      }
      const tok = await tokenCall(creds, form);
      const accessToken = dig(tok, cfg.accessTokenPath ?? "access_token");
      if (typeof accessToken !== "string") throw new AppError(ErrorCodes.GATEWAY_ERROR, `${tpl.key}: no access_token in response`);
      const expiresIn = cfg.expiresInPath ? dig(tok, cfg.expiresInPath) : tok.expires_in;
      const refreshToken = cfg.refreshTokenPath ? dig(tok, cfg.refreshTokenPath) : tok.refresh_token;
      let externalAccountId = "";
      let handle = tpl.name;
      let displayName: string | null = null;
      let pictureUrl: string | null = null;
      if (cfg.me) {
        const vars = { token: accessToken };
        const meHeaders: Record<string, string> = { ...(creds.headers ?? {}), ...((tpl.config.meHeaders ?? {}) as Record<string, string>) };
        for (const [k, v] of Object.entries(meHeaders)) meHeaders[k] = tplString(v, vars);
        const meRes = await fetch(base({ apiBase: creds.apiBase }) + cfg.me.path, {
          headers: { ...Object.fromEntries(Object.entries(meHeaders)), ...(Object.keys(meHeaders).length === 0 ? { authorization: `Bearer ${accessToken}` } : {}) },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        }).catch(() => null);
        const meJson = meRes ? ((await meRes.json().catch(() => ({}))) as Record<string, unknown>) : {};
        externalAccountId = String(dig(meJson, cfg.me.idPath) ?? "");
        handle = String(dig(meJson, cfg.me.handlePath ?? "username") ?? externalAccountId.slice(0, 12));
        displayName = (dig(meJson, cfg.me.namePath ?? "name") as string) ?? null;
        pictureUrl = (dig(meJson, cfg.me.picturePath ?? "avatar") as string) ?? null;
        if (!externalAccountId) throw new AppError(ErrorCodes.GATEWAY_ERROR, `${tpl.key}: could not resolve account from /me mapping`);
      }
      return {
        accessToken,
        refreshToken: typeof refreshToken === "string" ? refreshToken : null,
        expiresAt: typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000) : null,
        externalAccountId,
        handle,
        displayName,
        pictureUrl,
      };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      if (!cfg.publish?.path) throw new AppError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Connector ${tpl.key}: publish endpoint not configured`);
      const vars = {
        text: input.text,
        linkUrl: input.linkUrl ?? "",
        token: input.accessToken,
        accountId: input.externalAccountId,
        date: new Date().toISOString(),
      };
      const headers: Record<string, string> = {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
        ...(input.headers ?? {}),
        ...tplStringHeaders((cfg.publish.headers ?? {}) as Record<string, string>, vars),
      };
      const res = await fetch(base({ apiBase: input.apiBase }) + tplString(cfg.publish.path, vars), {
        method: "POST",
        headers,
        body: JSON.stringify(tplDeep(cfg.publish.body, vars)),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const id = res.ok ? dig(json, cfg.publish.idPath) : undefined;
      if (!res.ok || id == null) {
        throw new AppError(ErrorCodes.GATEWAY_ERROR, `${tpl.key} publish failed (${res.status})`, JSON.stringify(json).slice(0, 400));
      }
      const url = cfg.publish.urlPath ? dig(json, cfg.publish.urlPath) : undefined;
      return { externalId: String(id), url: typeof url === "string" ? url : null };
    },

    async refresh(creds, refreshToken) {
      if (!cfg.refresh && !tpl.tokenUrl) return null;
      const form = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        ...Object.fromEntries(
          Object.entries(((cfg.refresh?.body ?? {}) as Record<string, string>)).map(([k, v]) => [k, v]),
        ),
      });
      try {
        const tok = await tokenCall(creds, form);
        const accessToken = dig(tok, cfg.accessTokenPath ?? "access_token");
        const expiresIn = dig(tok, cfg.expiresInPath ?? "expires_in");
        if (typeof accessToken !== "string") return null;
        return { accessToken, expiresAt: new Date(Date.now() + (Number(expiresIn) || 3600) * 1000) };
      } catch {
        return null;
      }
    },
  };
}

function tplStringHeaders(h: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = tplString(v, vars);
  return out;
}

/* ------------------------------- registry -------------------------------- */

const builtins: Record<string, SocialProviderAdapter> = {
  facebook: facebookProvider,
  x: xProvider,
  linkedin: linkedinProvider,
  demo: demoProvider,
};

export async function resolveConnector(key: string, orgId: string | null): Promise<ConnectorTemplateRow | null> {
  const row = orgId
    ? await db.connectorTemplate.findFirst({ where: { key, OR: [{ orgId }, { orgId: null }] }, orderBy: { orgId: { sort: "asc", nulls: "last" } } })
    : await db.connectorTemplate.findFirst({ where: { orgId: null, key } });
  if (!row || !row.active) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    protocol: row.protocol as ConnectorTemplateRow["protocol"],
    capabilities: row.capabilities,
    authorizeUrl: row.authorizeUrl,
    tokenUrl: row.tokenUrl,
    apiBase: row.apiBase,
    scopes: row.scopes,
    config: (row.config ?? {}) as Record<string, unknown>,
    builtin: row.builtin,
    orgId: row.orgId,
  };
}

export async function getConnector(key: string, orgId: string): Promise<{ template: ConnectorTemplateRow; adapter: SocialProviderAdapter }> {
  const tpl = await resolveConnector(key, orgId);
  if (!tpl) {
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      `Unknown or inactive connector "${key}". Add a connector template under Settings → Connectors (no code needed).`,
    );
  }
  if (tpl.protocol === "BUILTIN") {
    const adapter = builtins[tpl.key];
    if (!adapter) {
      throw new AppError(
        ErrorCodes.PROVIDER_NOT_CONFIGURED,
        `Connector "${key}" is marked built-in but has no code adapter — configure it as an OAuth2 template instead.`,
      );
    }
    return { template: tpl, adapter };
  }
  return { template: tpl, adapter: genericAdapter(tpl) };
}

export async function listConnectors(orgId: string) {
  return db.connectorTemplate.findMany({
    where: { active: true, OR: [{ orgId }, { orgId: null }] },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
}
