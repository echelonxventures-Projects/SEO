import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getEnv } from "./env";

export type EncryptedPayload = {
  v: 1;
  keyVersion: number;
  iv: string;
  ct: string;
  tag: string;
};

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

export function randomBytes(n: number): Buffer {
  return crypto.randomBytes(n);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function hmacHex(secret: string, input: string): string {
  return crypto.createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Envelope-encrypt a secret at rest with AES-256-GCM.
 * `aad` binds the ciphertext to its purpose/owner so a stored blob cannot be
 * replayed onto a different entity (e.g. org A's gateway key used for org B).
 */
export function encryptSecret(plaintext: string, aad: string): EncryptedPayload {
  const env = getEnv();
  const keyVersion = env.ENCRYPTION_KEY_VERSION;
  const key = env.ENCRYPTION_KEYS[keyVersion];
  const iv = randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    keyVersion,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(payload: unknown, aad: string): string {
  const p = payload as EncryptedPayload | null;
  if (
    !p ||
    typeof p !== "object" ||
    p.v !== 1 ||
    typeof p.keyVersion !== "number" ||
    typeof p.iv !== "string" ||
    typeof p.ct !== "string" ||
    typeof p.tag !== "string"
  ) {
    throw new Error("Malformed encrypted payload");
  }
  const env = getEnv();
  const key = env.ENCRYPTION_KEYS[p.keyVersion];
  if (!key) {
    throw new Error(`Encryption key version ${p.keyVersion} not present in keyring`);
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(p.iv, "base64"), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(p.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(p.ct, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, getEnv().BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
