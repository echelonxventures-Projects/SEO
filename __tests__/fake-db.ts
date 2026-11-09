/**
 * Minimal in-memory stand-in for the Prisma client — just enough surface for
 * the ledger / billing webhook paths under test. Supports equality filters,
 * `{ in: [...] }`, `{ not: x }`, `{ increment: n }` updates and compound
 * unique keys, and throws on unique violations like Postgres would.
 */
type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

let seq = 0;
const nextId = (p: string) => `${p}_${++seq}`;

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond === undefined) return true;
    if (k === "OR") return (cond as Where[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      const OPS = ["in", "not", "gt", "gte", "lt", "lte"];
      if (Object.keys(c).some((op) => OPS.includes(op))) {
        // every operator present must hold (e.g. { gte: a, lt: b })
        const cmp = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
        const has = v !== null && v !== undefined;
        return Object.entries(c).every(([op, arg]) => {
          if (op === "in") return (arg as unknown[]).includes(v);
          if (op === "not") return v !== arg;
          if (!has) return false; // SQL: NULL never satisfies a range
          if (op === "gt") return cmp(v) > cmp(arg);
          if (op === "gte") return cmp(v) >= cmp(arg);
          if (op === "lt") return cmp(v) < cmp(arg);
          if (op === "lte") return cmp(v) <= cmp(arg);
          return true;
        });
      }
      // compound unique key, e.g. providerCode_externalId: {providerCode, externalId}
      return Object.entries(c).every(([ck, cv]) => row[ck] === cv);
    }
    if (cond === null) return v === null || v === undefined; // unset column reads as NULL
    return v === cond;
  });
}

function applyData(row: Row, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) {
      const inc = (v as { increment: bigint | number }).increment;
      row[k] = typeof inc === "bigint" ? (row[k] as bigint) + inc : (row[k] as number) + inc;
    } else {
      row[k] = v;
    }
  }
}

function table(name: string, uniques: string[][] = [], defaults: Record<string, unknown> = {}) {
  const rows: Row[] = [];
  const violates = (candidate: Row, self?: Row) =>
    uniques.some((cols) =>
      rows.some((r) => r !== self && cols.every((c) => r[c] !== undefined && r[c] === candidate[c])),
    );
  return {
    rows,
    async create({ data }: { data: Record<string, unknown> }) {
      const row = { id: nextId(name), createdAt: new Date(), ...defaults, ...data } as Row;
      if (violates(row)) {
        const err = new Error(`Unique constraint failed on ${name}`) as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      rows.push(row);
      return { ...row };
    },
    async findFirst({ where }: { where?: Where } = {}) {
      const r = rows.find((x) => matches(x, where));
      return r ? { ...r } : null;
    },
    async findUnique({ where }: { where: Where }) {
      const r = rows.find((x) => matches(x, where));
      return r ? { ...r } : null;
    },
    async findUniqueOrThrow({ where }: { where: Where }) {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      return { ...r };
    },
    async findMany({ where }: { where?: Where } = {}) {
      return rows.filter((x) => matches(x, where)).map((r) => ({ ...r }));
    },
    async update({ where, data }: { where: Where; data: Record<string, unknown> }) {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error(`${name} not found`);
      applyData(r, data);
      return { ...r };
    },
    async updateMany({ where, data }: { where: Where; data: Record<string, unknown> }) {
      const hit = rows.filter((x) => matches(x, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    },
    async count({ where }: { where?: Where } = {}) {
      return rows.filter((x) => matches(x, where)).length;
    },
  };
}

export function createFakeDb() {
  let paymentSeq = 0;
  const fake = {
    gatewayConfig: table("gw"),
    webhookEvent: table("whe", [["providerCode", "externalId"]]),
    invoice: table("inv"),
    payment: table("pay", [["orgId", "number"]]),
    user: table("user"),
    domainEvent: table("evt"),
    billingCycle: table("cycle"),
    subscription: table("sub"),
    activityLog: table("log"),
    emailCampaign: table("camp"),
    emailSend: table("send"),
    organization: table("org"),
    otpToken: table("otp", [["codeHash"]], { attempts: 0, consumedAt: null }),
    session: table("session"),
    /** Document numbering (`nextDocumentNumber`) — one sequence for all orgs. */
    async $queryRaw() {
      paymentSeq += 1;
      return [{ pattern: "{PREFIX}-{SEQ}", prefix: "PAY", padding: 4, value: paymentSeq }];
    },
    async $executeRaw() {
      return 0; // advisory locks are a no-op in a single-threaded fake
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(fake);
    },
  };
  return fake;
}

export type FakeDb = ReturnType<typeof createFakeDb>;
