jest.mock("../src/server/db", () => ({ db: {} }));
jest.mock("../src/generated/prisma/client", () => ({ Prisma: {} }));

import { clientIp } from "../src/server/audit";
import { originAllowed } from "../src/server/services/temporal-widgets.service";

describe("clientIp — X-Forwarded-For can't be spoofed", () => {
  const ORIGINAL = process.env.OMNI_TRUSTED_PROXY_HOPS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OMNI_TRUSTED_PROXY_HOPS;
    else process.env.OMNI_TRUSTED_PROXY_HOPS = ORIGINAL;
  });
  const h = (xff: string) => new Headers({ "x-forwarded-for": xff });

  it("uses the entry our proxy appended, not the client-supplied left one", () => {
    process.env.OMNI_TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(h("6.6.6.6, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("honours multiple trusted hops", () => {
    process.env.OMNI_TRUSTED_PROXY_HOPS = "2";
    expect(clientIp(h("6.6.6.6, 203.0.113.7, 10.0.0.2"))).toBe("203.0.113.7");
  });

  it("ignores forwarding headers when hops = 0", () => {
    process.env.OMNI_TRUSTED_PROXY_HOPS = "0";
    expect(clientIp(h("203.0.113.7"))).toBeNull();
  });

  it("rejects garbage values", () => {
    process.env.OMNI_TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(h("<script>"))).toBeNull();
  });
});

describe("originAllowed — exact widget origin matching", () => {
  const list = ["https://shop.com", "https://*.brand.io"];

  it("allows any origin when the allowlist is empty", () => {
    expect(originAllowed("https://anything.example", [])).toBe(true);
  });

  it("matches exact origins, ignoring trailing slash and case", () => {
    expect(originAllowed("https://shop.com", list)).toBe(true);
    expect(originAllowed("https://SHOP.com", ["https://shop.com/"])).toBe(true);
  });

  it("does NOT admit look-alike prefixes (old startsWith bug)", () => {
    expect(originAllowed("https://shop.com.evil.net", list)).toBe(false);
    expect(originAllowed("https://shop.community", list)).toBe(false);
  });

  it("rejects wrong scheme or port", () => {
    expect(originAllowed("http://shop.com", list)).toBe(false);
    expect(originAllowed("https://shop.com:8443", list)).toBe(false);
  });

  it("supports *.domain wildcards for subdomains only", () => {
    expect(originAllowed("https://eu.brand.io", list)).toBe(true);
    expect(originAllowed("https://brand.io", list)).toBe(false);
    expect(originAllowed("https://evilbrand.io", list)).toBe(false);
  });

  it("fails closed for unknown embedders", () => {
    expect(originAllowed(null, list)).toBe(false);
    expect(originAllowed("not a url", list)).toBe(false);
  });
});

describe("assertCronSecret", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://x:y@localhost:5432/z",
      APP_URL: "http://localhost:3000",
      OMNI_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32).toString("base64") }),
      OMNI_TOKEN_SECRET: "t".repeat(40),
      CRON_SECRET: "cron-secret-0123456789",
    });
  });
  const req = (auth?: string) =>
    new Request("http://localhost/api/v1/cron/renew", { method: "POST", headers: auth ? { authorization: auth } : {} });

  it("accepts the right bearer and rejects everything else", async () => {
    const { assertCronSecret } = await import("../src/server/cron");
    expect(() => assertCronSecret(req("Bearer cron-secret-0123456789"))).not.toThrow();
    expect(() => assertCronSecret(req("Bearer cron-secret-0123456788"))).toThrow("Invalid cron secret");
    expect(() => assertCronSecret(req("Basic cron-secret-0123456789"))).toThrow();
    expect(() => assertCronSecret(req())).toThrow();
  });
});

describe("SSRF guard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const guard = require("../src/server/net-guard") as typeof import("../src/server/net-guard");
  const ORIGINAL = process.env.OMNI_ALLOW_PRIVATE_EGRESS;
  beforeEach(() => {
    process.env.OMNI_ALLOW_PRIVATE_EGRESS = "0";
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.OMNI_ALLOW_PRIVATE_EGRESS;
    else process.env.OMNI_ALLOW_PRIVATE_EGRESS = ORIGINAL;
  });

  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1",
  ])("treats %s as private", (ip) => {
    expect(guard.isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("treats %s as public", (ip) => {
    expect(guard.isPrivateAddress(ip)).toBe(false);
  });

  it("refuses internal and metadata targets and non-http schemes", async () => {
    await expect(guard.assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow("blocked");
    await expect(guard.assertPublicUrl("http://127.0.0.1:5432/")).rejects.toThrow("blocked");
    await expect(guard.assertPublicUrl("http://[::1]/")).rejects.toThrow("blocked");
    await expect(guard.assertPublicUrl("file:///etc/passwd")).rejects.toThrow("not allowed");
    await expect(guard.assertPublicUrl("https://user:pw@8.8.8.8/")).rejects.toThrow("Credentials");
  });

  it("allows public IP literals, and private ones only when explicitly enabled", async () => {
    await expect(guard.assertPublicUrl("https://8.8.8.8/")).resolves.toBeInstanceOf(URL);
    process.env.OMNI_ALLOW_PRIVATE_EGRESS = "1";
    await expect(guard.assertPublicUrl("http://127.0.0.1:4000/hook")).resolves.toBeInstanceOf(URL);
  });

  it("re-checks redirect targets", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    ) as unknown as typeof fetch;
    try {
      await expect(guard.guardedFetch("https://8.8.8.8/redirect")).rejects.toThrow("blocked");
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("requireOwnedForWrite — platform defaults are read-only for workspaces", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireOwnedForWrite } = require("../src/server/services/common") as typeof import("../src/server/services/common");
  const ctx = (isPlatformAdmin: boolean) =>
    ({ orgId: "org_a", viewer: { isPlatformAdmin } }) as Parameters<typeof requireOwnedForWrite>[2];

  it("lets a workspace write its own rows", async () => {
    await expect(requireOwnedForWrite({ orgId: "org_a" }, "Tax rate", ctx(false))).resolves.toEqual({ orgId: "org_a" });
  });

  it("refuses workspace writes to platform rows (e.g. global GST groups)", async () => {
    await expect(requireOwnedForWrite({ orgId: null }, "Tax rate", ctx(false))).rejects.toThrow("platform default");
  });

  it("allows platform admins to maintain platform rows", async () => {
    await expect(requireOwnedForWrite({ orgId: null }, "Tax rate", ctx(true))).resolves.toEqual({ orgId: null });
  });

  it("hides other tenants' rows as not found", async () => {
    await expect(requireOwnedForWrite({ orgId: "org_b" }, "Tax rate", ctx(true))).rejects.toThrow("not found");
  });
});

describe("response serializer never ships secrets", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { jsonSafe } = require("../src/server/serialize") as typeof import("../src/server/serialize");

  it("strips *Enc columns and credential hashes at any depth", () => {
    const row = {
      id: "t1",
      secretEnc: { v: 1, ct: "x" },
      url: "https://sink.example",
      owner: { passwordHash: "$2b$...", totpSecretEnc: { v: 1 }, recoveryCodesHash: ["h"], name: "A" },
      sessions: [{ tokenHash: "abc", csrfSecret: "s", ip: "203.0.113.1" }],
    };
    expect(jsonSafe(row)).toEqual({
      id: "t1",
      url: "https://sink.example",
      owner: { name: "A" },
      sessions: [{ ip: "203.0.113.1" }],
    });
  });

  it("keeps the one-time plaintext secret and non-credential hashes", () => {
    expect(jsonSafe({ secret: "tsec_1", bodyHash: "b", valueHash: "v", currency: "INR" })).toEqual({
      secret: "tsec_1", bodyHash: "b", valueHash: "v", currency: "INR",
    });
  });
});
