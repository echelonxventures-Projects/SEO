import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { decryptSecret, encryptSecret, randomToken, sha256, safeEqual } from "../crypto";
import { getConnector, listConnectors, resolveConnector, connectorAad, type ConnectorTemplateRow } from "../connectors/engine";
import type { SocialAppCreds, TokenBundle } from "../social-providers/types";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function appAadFor(orgId: string, key: string): string {
  return connectorAad(orgId, key);
}

function connectionAad(con: { orgId: string; connectorKey: string; id: string }): string {
  return `social:${con.orgId}:${con.connectorKey}:${con.id}`;
}

// ---------------------------------------------------------------------------
// Discovery (cards render from connector templates — any platform, ever)
// ---------------------------------------------------------------------------

export async function listNetworks(ctx: Ctx) {
  const [templates, apps, connections] = await Promise.all([
    listConnectors(ctx.orgId),
    db.socialAppConfig.findMany({ where: { orgId: ctx.orgId } }),
    db.socialConnection.findMany({ where: { orgId: ctx.orgId, status: { not: "DISCONNECTED" } } }),
  ]);
  return templates.map((t) => {
    const app = apps.find((a) => a.connectorKey === t.key);
    const conns = connections.filter((c) => c.connectorKey === t.key);
    const filled = app && !app.clientId.includes("REPLACE-ME");
    return {
      key: t.key,
      name: t.name,
      protocol: t.protocol,
      capabilities: t.capabilities,
      docsUrl: t.docsUrl,
      icon: t.icon,
      appConfigured: Boolean(filled),
      connected: conns.length,
      accounts: conns.map((c) => ({ id: c.id, handle: c.displayName ?? c.handle, status: c.status })),
    };
  });
}

export async function listConnections(ctx: Ctx) {
  return db.socialConnection.findMany({
    where: { orgId: ctx.orgId, status: { not: "DISCONNECTED" } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Connector templates — add any future platform as data
// ---------------------------------------------------------------------------

export const connectorTemplateSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,38}$/, "lowercase letters, digits, dash, underscore (2-39 chars)"),
  name: z.string().trim().min(2).max(60),
  protocol: z.enum(["OAUTH2_CODE", "OAUTH2_PKCE", "BUILTIN"]).default("OAUTH2_CODE"),
  authorizeUrl: z.string().url().max(600).nullable().default(null),
  tokenUrl: z.string().url().max(600).nullable().default(null),
  apiBase: z.string().url().max(600).nullable().default(null),
  scopes: z.array(z.string().trim().max(80)).max(30).default([]),
  capabilities: z.array(z.string().trim().max(40)).max(10).default(["publish"]),
  docsUrl: z.string().url().max(600).nullable().default(null),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function createConnectorTemplate(ctx: Ctx, input: unknown) {
  const data = connectorTemplateSchema.parse(input);
  if (data.protocol !== "BUILTIN" && (!data.authorizeUrl || !data.tokenUrl || !data.config.publish)) {
    throw new AppError(ErrorCodes.VALIDATION, "OAuth2 connectors need authorizeUrl, tokenUrl and config.publish {path, body, idPath}");
  }
  const existing = await db.connectorTemplate.findFirst({ where: { orgId: ctx.orgId, key: data.key } });
  if (existing) throw new AppError(ErrorCodes.CONFLICT, `Connector key "${data.key}" already exists in this workspace`);
  const row = await db.connectorTemplate.create({
    data: { orgId: ctx.orgId, ...data, config: data.config as object },
  });
  await audit(db, ctx, "connector.created", undefined, row.id, { key: row.key });
  return { id: row.id, key: row.key };
}

export async function toggleConnectorTemplate(ctx: Ctx, id: string, active: boolean) {
  const row = await requireOwned(await db.connectorTemplate.findUnique({ where: { id } }), "Connector", ctx.orgId);
  if (row.orgId === null && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Global connectors require platform access");
  }
  await db.connectorTemplate.update({ where: { id }, data: { active } });
  await audit(db, ctx, active ? "connector.enabled" : "connector.disabled", undefined, id);
}

// ---------------------------------------------------------------------------
// App credentials (per workspace, per connector)
// ---------------------------------------------------------------------------

export const socialAppSchema = z.object({
  connectorKey: z.string().trim().toLowerCase().min(2).max(40),
  clientId: z.string().trim().min(3).max(200),
  clientSecret: z.string().trim().min(3).max(400),
  scopes: z.array(z.string().trim().max(80)).max(30).default([]),
  authorizeUrl: z.string().url().max(600).nullable().optional(),
  tokenUrl: z.string().url().max(600).nullable().optional(),
  apiBase: z.string().url().max(600).nullable().optional(),
  headers: z.record(z.string().trim().max(80), z.string().trim().max(200)).nullable().optional(),
});

export async function upsertSocialApp(ctx: Ctx, input: unknown) {
  const data = socialAppSchema.parse(input);
  const tpl = await resolveConnector(data.connectorKey, ctx.orgId);
  if (!tpl) throw new AppError(ErrorCodes.NOT_FOUND, `Unknown connector "${data.connectorKey}"`);
  if (tpl.builtin && tpl.key === "demo") {
    throw new AppError(ErrorCodes.VALIDATION, "Demo connector needs no app credentials");
  }
  const enc = encryptSecret(JSON.stringify({ clientSecret: data.clientSecret }), appAadFor(ctx.orgId, data.connectorKey));
  const existing = await db.socialAppConfig.findUnique({ where: { orgId_connectorKey: { orgId: ctx.orgId, connectorKey: data.connectorKey } } });
  const saved = existing
    ? await db.socialAppConfig.update({
        where: { id: existing.id },
        data: {
          clientId: data.clientId,
          clientSecretEnc: enc,
          scopes: data.scopes,
          authorizeUrl: data.authorizeUrl ?? null,
          tokenUrl: data.tokenUrl ?? null,
          apiBase: data.apiBase ?? null,
          extraHeaders: (data.headers ?? undefined) as object,
          active: true,
        },
      })
    : await db.socialAppConfig.create({
        data: {
          orgId: ctx.orgId,
          connectorKey: data.connectorKey,
          clientId: data.clientId,
          clientSecretEnc: enc,
          scopes: data.scopes,
          authorizeUrl: data.authorizeUrl ?? null,
          tokenUrl: data.tokenUrl ?? null,
          apiBase: data.apiBase ?? null,
          extraHeaders: (data.headers ?? undefined) as object,
          active: true,
        },
      });
  await audit(db, ctx, "social.app_configured", undefined, saved.id, { connector: data.connectorKey });
  return { id: saved.id, connectorKey: data.connectorKey };
}

export async function listSocialApps(ctx: Ctx) {
  const rows = await db.socialAppConfig.findMany({ where: { orgId: ctx.orgId } });
  return rows.map((r) => ({
    id: r.id,
    connectorKey: r.connectorKey,
    clientId: r.clientId,
    scopes: r.scopes,
    authorizeUrl: r.authorizeUrl,
    tokenUrl: r.tokenUrl,
    apiBase: r.apiBase,
    extraHeaders: r.extraHeaders,
    active: r.active,
  }));
}

async function credsFor(orgId: string, tpl: ConnectorTemplateRow): Promise<SocialAppCreds> {
  const cfg = await db.socialAppConfig.findUnique({ where: { orgId_connectorKey: { orgId, connectorKey: tpl.key } } });
  if (!cfg || !cfg.active || cfg.clientId.includes("REPLACE-ME")) {
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      `No app credentials for "${tpl.name}". Open the ${tpl.key} card and fill in client id + secret.`,
    );
  }
  const { clientSecret } = JSON.parse(decryptSecret(cfg.clientSecretEnc, appAadFor(orgId, tpl.key))) as { clientSecret: string };
  return {
    clientId: cfg.clientId,
    clientSecret,
    scopes: cfg.scopes.length ? cfg.scopes : (tpl.scopes as string[]),
    authorizeUrl: cfg.authorizeUrl,
    tokenUrl: cfg.tokenUrl,
    apiBase: cfg.apiBase,
    headers: (cfg.extraHeaders ?? undefined) as Record<string, string> | undefined,
  };
}

// ---------------------------------------------------------------------------
// OAuth dance
// ---------------------------------------------------------------------------

export async function beginConnect(ctx: Ctx, input: unknown): Promise<{ authorizeUrl: string }> {
  const { connectorKey, clientId } = z
    .object({ connectorKey: z.string().trim().toLowerCase().min(2).max(40), clientId: z.string().max(64).nullable().default(null) })
    .parse(input);
  const tpl = await resolveConnector(connectorKey, ctx.orgId);
  if (!tpl) throw new AppError(ErrorCodes.NOT_FOUND, `Unknown connector "${connectorKey}"`);
  if (tpl.key === "demo") throw new AppError(ErrorCodes.VALIDATION, "Use the demo-connect action for the sandbox channel");
  const creds = await credsFor(ctx.orgId, tpl);
  const { adapter } = await getConnector(tpl.key, ctx.orgId);
  const state = randomToken(24);
  let verifier: string | null = null;
  let pkce: { challenge: string } | undefined;
  if (tpl.protocol === "OAUTH2_PKCE") {
    verifier = randomToken(32);
    pkce = { challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
  }
  await db.oAuthPending.create({
    data: {
      orgId: ctx.orgId,
      connectorKey: tpl.key,
      stateHash: sha256(state),
      verifierEnc: verifier ? (encryptSecret(verifier, `oauth:${ctx.orgId}:${tpl.key}`) as never) : undefined,
      userId: ctx.userId,
      redirectTo: clientId ?? null,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    },
  });
  const redirectUri = `${process.env.APP_URL ?? ""}/api/v1/social/callback`;
  return { authorizeUrl: adapter.authorizeUrl(creds, state, redirectUri, pkce) };
}

export async function connectDemo(ctx: Ctx) {
  await assertWritable(ctx.orgId);
  const tpl = await resolveConnector("demo", ctx.orgId);
  if (!tpl) throw new AppError(ErrorCodes.PROVIDER_NOT_CONFIGURED, "Demo connector template missing — re-run the seed");
  const con = await db.socialConnection.upsert({
    where: {
      orgId_connectorKey_externalAccountId: { orgId: ctx.orgId, connectorKey: "demo", externalAccountId: "demo-channel" },
    },
    create: {
      orgId: ctx.orgId,
      connectorKey: "demo",
      externalAccountId: "demo-channel",
      handle: "Demo Channel",
      displayName: "Demo Channel (sandbox)",
      accessTokenEnc: encryptSecret("demo", "social:pending"),
      connectedById: ctx.userId,
    },
    update: { status: "CONNECTED" },
  });
  await db.socialConnection.update({
    where: { id: con.id },
    data: { accessTokenEnc: encryptSecret("demo", connectionAad(con)) },
  });
  await audit(db, ctx, "social.connected", undefined, con.id, { connector: "demo" });
  return { id: con.id };
}

export async function completeConnect(state: string, code: string): Promise<{ connectionId: string; orgId: string }> {
  const pending = await db.oAuthPending.findUnique({ where: { stateHash: sha256(state) } });
  if (!pending || pending.consumedAt || pending.expiresAt < new Date()) {
    throw new AppError(ErrorCodes.FORBIDDEN, "This sign-in attempt is expired or invalid");
  }
  const tpl = await resolveConnector(pending.connectorKey, pending.orgId);
  if (!tpl) throw new AppError(ErrorCodes.PROVIDER_NOT_CONFIGURED, "Connector was removed — restart the connection");
  const { adapter } = await getConnector(tpl.key, pending.orgId);
  const creds = await credsFor(pending.orgId, tpl);
  const verifier = pending.verifierEnc ? decryptSecret(pending.verifierEnc, `oauth:${pending.orgId}:${pending.connectorKey}`) : null;
  const redirectUri = `${process.env.APP_URL ?? ""}/api/v1/social/callback`;
  const bundle: TokenBundle = await adapter.exchangeCode(creds, code, redirectUri, verifier);
  await db.oAuthPending.update({ where: { id: pending.id }, data: { consumedAt: new Date() } });

  const connection = await db.socialConnection.upsert({
    where: {
      orgId_connectorKey_externalAccountId: { orgId: pending.orgId, connectorKey: tpl.key, externalAccountId: bundle.externalAccountId },
    },
    create: {
      orgId: pending.orgId,
      clientId: pending.redirectTo,
      connectorKey: tpl.key,
      externalAccountId: bundle.externalAccountId,
      handle: bundle.handle,
      displayName: bundle.displayName ?? null,
      profilePictureUrl: bundle.pictureUrl ?? null,
      accessTokenEnc: encryptSecret("pending", "social:pending"),
      tokenExpiresAt: bundle.expiresAt ?? null,
      scopes: creds.scopes,
      connectedById: pending.userId,
    },
    update: {
      clientId: pending.redirectTo,
      handle: bundle.handle,
      displayName: bundle.displayName ?? null,
      profilePictureUrl: bundle.pictureUrl ?? null,
      tokenExpiresAt: bundle.expiresAt ?? null,
      status: "CONNECTED",
      lastError: null,
    },
  });
  await db.socialConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEnc: encryptSecret(bundle.accessToken, connectionAad(connection)),
      ...(bundle.refreshToken ? { refreshTokenEnc: encryptSecret(bundle.refreshToken, `${connectionAad(connection)}:refresh`) } : {}),
    },
  });
  await audit(db, { orgId: pending.orgId, userId: pending.userId, ip: null }, "social.connected", undefined, connection.id, { connector: tpl.key });
  return { connectionId: connection.id, orgId: pending.orgId };
}

export async function disconnect(ctx: Ctx, id: string) {
  const con = await requireOwned(await db.socialConnection.findUnique({ where: { id } }), "Connection", ctx.orgId);
  await db.socialConnection.update({ where: { id }, data: { status: "DISCONNECTED" } });
  await audit(db, ctx, "social.disconnected", undefined, id, { connector: con.connectorKey });
}

/** Publisher secrets — never exposed via API. */
export type ConnectionSecrets = { accessToken: string; apiBase: string | null; headers: Record<string, string> | undefined };

export async function connectionToken(con: {
  id: string;
  orgId: string;
  connectorKey: string;
  accessTokenEnc: unknown;
  refreshTokenEnc?: unknown;
  tokenExpiresAt: Date | null;
  status: string;
}): Promise<ConnectionSecrets> {
  const tpl = await resolveConnector(con.connectorKey, con.orgId);
  if (!tpl) throw new AppError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Connector "${con.connectorKey}" is no longer available`);
  const { adapter } = await getConnector(con.connectorKey, con.orgId);
  let token: string;
  try {
    token = decryptSecret(con.accessTokenEnc, connectionAad(con));
  } catch {
    throw new AppError(ErrorCodes.INTERNAL, "Connection token failed integrity check — reconnect the account");
  }
  const proto = await appProtoConfig(con.orgId, con.connectorKey);
  if (con.tokenExpiresAt && con.tokenExpiresAt < new Date(Date.now() + 60_000)) {
    if (con.refreshTokenEnc && adapter.refresh) {
      const creds = await credsFor(con.orgId, tpl).catch(() => null);
      if (creds) {
        const newToken = await adapter.refresh(creds, decryptSecret(con.refreshTokenEnc, `${connectionAad(con)}:refresh`));
        if (newToken) {
          await db.socialConnection.update({
            where: { id: con.id },
            data: {
              accessTokenEnc: encryptSecret(newToken.accessToken, connectionAad(con)),
              tokenExpiresAt: newToken.expiresAt,
              status: "CONNECTED",
            },
          });
          return { accessToken: newToken.accessToken, apiBase: proto?.apiBase ?? null, headers: proto?.headers };
        }
      }
    }
    await db.socialConnection.update({ where: { id: con.id }, data: { status: "TOKEN_EXPIRED" } });
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Token expired — reconnect the account");
  }
  return { accessToken: token, apiBase: proto?.apiBase ?? null, headers: proto?.headers };
}

async function appProtoConfig(orgId: string, connectorKey: string) {
  const cfg = await db.socialAppConfig.findUnique({ where: { orgId_connectorKey: { orgId, connectorKey } } });
  return cfg
    ? { apiBase: cfg.apiBase, headers: (cfg.extraHeaders ?? undefined) as Record<string, string> | undefined }
    : { apiBase: null, headers: undefined as Record<string, string> | undefined };
}
