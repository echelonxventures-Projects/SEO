/**
 * Columns that must never reach a client, whatever a service returns: every
 * `*Enc` (encrypted credentials/secrets) plus credential hashes. Services
 * sometimes return raw Prisma rows (`return db.x.update(...)`); this is the
 * backstop so those rows can't ship ciphertext or hashes in a response.
 */
const SECRET_KEYS = new Set([
  "passwordHash", "recoveryCodesHash", "tokenHash", "keyHash", "codeHash", "stateHash", "csrfSecret",
]);
export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key) || /^[a-z][A-Za-z]*Enc$/.test(key);
}

export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key && isSecretKey(key)) return undefined;
      if (typeof v === "bigint") {
        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error("BigInt value exceeds safe JSON range");
        }
        return Number(v);
      }
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  );
}

export function ok(data: unknown, status = 200): Response {
  return Response.json(jsonSafe({ data }), { status });
}

export function created(data: unknown): Response {
  return ok(data, 201);
}
