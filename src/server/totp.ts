import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return Buffer.from(bytes);
}

export function totpCode(secretB32: string, counter = Math.floor(Date.now() / 1000 / PERIOD)): string {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

/** Verifies with ±1 step skew, constant-time compare. */
export function verifyTotp(secretB32: string, code: string): boolean {
  const norm = code.replace(/\D/g, "");
  if (norm.length !== DIGITS) return false;
  const now = Math.floor(Date.now() / 1000 / PERIOD);
  for (const skew of [0, 1, -1]) {
    const a = Buffer.from(norm.padEnd(6, "0"));
    const b = Buffer.from(totpCode(secretB32, now + skew).padEnd(6, "0"));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUri(secretB32: string, email: string, issuer = "OmniMark"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&period=${PERIOD}&digits=${DIGITS}`;
}

export function generateRecoveryCodes(n = 8): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => {
    const raw = randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
