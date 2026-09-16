export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
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
