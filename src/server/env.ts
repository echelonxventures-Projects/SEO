import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url(),
  OMNI_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  OMNI_ENCRYPTION_KEYS: z.string().min(1),
  OMNI_TOKEN_SECRET: z.string().min(32, "OMNI_TOKEN_SECRET must be at least 32 chars"),
  OMNI_RATE_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
  OMNI_RATE_API_PER_MIN: z.coerce.number().int().positive().default(120),
  OMNI_BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  OMNI_LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).default(10),
  OMNI_LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  CRON_SECRET: z.string().min(16).optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  OMNI_WEBHOOK_BASE_URL: z.union([z.string().url(), z.literal("")]).optional(),
});

export type Env = {
  NODE_ENV: "development" | "test" | "production";
  IS_PRODUCTION: boolean;
  DATABASE_URL: string;
  APP_URL: string;
  ENCRYPTION_KEY_VERSION: number;
  ENCRYPTION_KEYS: Record<number, Buffer>;
  TOKEN_SECRET: string;
  RATE_AUTH_PER_MIN: number;
  RATE_API_PER_MIN: number;
  BCRYPT_ROUNDS: number;
  LOGIN_MAX_FAILURES: number;
  LOGIN_LOCK_MINUTES: number;
  CRON_SECRET: string | null;
  SMTP_URL: string | null;
  MAIL_FROM: string | null;
  WEBHOOK_BASE_URL: string;
};

let cached: Env | null = null;

function parseEncryptionKeys(raw: string, current: number): Record<number, Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OMNI_ENCRYPTION_KEYS must be a JSON object of {version: base64Key}");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("OMNI_ENCRYPTION_KEYS must be a JSON object of {version: base64Key}");
  }
  const keys: Record<number, Buffer> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const version = Number(k);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`OMNI_ENCRYPTION_KEYS: invalid key version "${k}"`);
    }
    if (typeof v !== "string") {
      throw new Error(`OMNI_ENCRYPTION_KEYS: key ${k} must be a base64 string`);
    }
    const buf = Buffer.from(v, "base64");
    if (buf.length !== 32) {
      throw new Error(`OMNI_ENCRYPTION_KEYS: key ${k} must decode to exactly 32 bytes (256-bit)`);
    }
    keys[version] = buf;
  }
  if (!keys[current]) {
    throw new Error(`OMNI_ENCRYPTION_KEYS must contain the current version ${current}`);
  }
  return keys;
}

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const e = parsed.data;
  cached = {
    NODE_ENV: e.NODE_ENV,
    IS_PRODUCTION: e.NODE_ENV === "production",
    DATABASE_URL: e.DATABASE_URL,
    APP_URL: e.APP_URL.replace(/\/$/, ""),
    ENCRYPTION_KEY_VERSION: e.OMNI_ENCRYPTION_KEY_VERSION,
    ENCRYPTION_KEYS: parseEncryptionKeys(e.OMNI_ENCRYPTION_KEYS, e.OMNI_ENCRYPTION_KEY_VERSION),
    TOKEN_SECRET: e.OMNI_TOKEN_SECRET,
    RATE_AUTH_PER_MIN: e.OMNI_RATE_AUTH_PER_MIN,
    RATE_API_PER_MIN: e.OMNI_RATE_API_PER_MIN,
    BCRYPT_ROUNDS: e.OMNI_BCRYPT_ROUNDS,
    LOGIN_MAX_FAILURES: e.OMNI_LOGIN_MAX_FAILURES,
    LOGIN_LOCK_MINUTES: e.OMNI_LOGIN_LOCK_MINUTES,
    CRON_SECRET: e.CRON_SECRET ?? null,
    SMTP_URL: e.SMTP_URL ? e.SMTP_URL : null,
    MAIL_FROM: e.MAIL_FROM ? e.MAIL_FROM : null,
    WEBHOOK_BASE_URL: (e.OMNI_WEBHOOK_BASE_URL ?? e.APP_URL).replace(/\/$/, ""),
  };
  return cached;
}
