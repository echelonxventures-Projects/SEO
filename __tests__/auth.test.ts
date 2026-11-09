import { createFakeDb, type FakeDb } from "./fake-db";

const holder: { db: FakeDb } = { db: createFakeDb() };
jest.mock("../src/server/db", () => ({
  get db() {
    return holder.db;
  },
}));
jest.mock("../src/generated/prisma/client", () => ({ Prisma: { DbNull: "__DbNull__" } }));
jest.mock("../src/server/mail", () => ({ sendMail: jest.fn(async () => undefined) }));
jest.mock("../src/server/sessions", () => ({
  createSession: jest.fn(async () => ({ token: "t", csrf: "c", expiresAt: new Date() })),
}));

Object.assign(process.env, {
  DATABASE_URL: "postgresql://x:y@localhost:5432/z",
  APP_URL: "http://localhost:3000",
  OMNI_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 7).toString("base64") }),
  OMNI_TOKEN_SECRET: "t".repeat(40),
  OMNI_BCRYPT_ROUNDS: "10",
  OMNI_LOGIN_MAX_FAILURES: "3",
});

import {
  beginTotpSetup,
  completeMfaLogin,
  confirmTotpSetup,
  disableTotp,
  login,
} from "../src/server/services/auth.service";
import { hashPassword } from "../src/server/crypto";
import { signToken } from "../src/server/tokens";

const meta = { ip: "203.0.113.1", userAgent: "jest" };

async function addUser(db: FakeDb, over: Record<string, unknown> = {}) {
  return db.user.create({
    data: {
      email: "a@example.com",
      emailNormalized: "a@example.com",
      name: "A",
      passwordHash: await hashPassword("Correct-Horse-1"),
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
      totpEnabledAt: null,
      totpSecretEnc: null,
      recoveryCodesHash: [],
      ...over,
    },
  });
}

beforeEach(() => {
  holder.db = createFakeDb();
  // tables the auth flows touch beyond the shared fake
  Object.assign(holder.db, { membership: { findFirst: async () => null } });
});

describe("login", () => {
  it("does the same bcrypt work for unknown emails (no timing enumeration)", async () => {
    await addUser(holder.db);
    const t0 = Date.now();
    await expect(login({ email: "nobody@example.com", password: "whatever" }, meta)).rejects.toThrow("Incorrect email or password");
    const unknownMs = Date.now() - t0;
    // bcrypt cost 10 takes tens of ms; a bare DB miss takes ~0ms
    expect(unknownMs).toBeGreaterThan(15);
  });
});

describe("2FA", () => {
  it("refuses to restart setup while 2FA is enabled (no silent rebind)", async () => {
    const u = await addUser(holder.db, { totpEnabledAt: new Date(), totpSecretEnc: { v: 1 } });
    await expect(beginTotpSetup(u.id)).rejects.toThrow("already enabled");
    await expect(confirmTotpSetup(u.id, "123456")).rejects.toThrow("already enabled");
  });

  it("enforces the account lockout at the MFA step", async () => {
    const u = await addUser(holder.db, {
      totpEnabledAt: new Date(),
      totpSecretEnc: { v: 1 },
      lockedUntil: new Date(Date.now() + 10 * 60_000),
    });
    const mfaToken = signToken("mfa", u.id, 300);
    await expect(completeMfaLogin(mfaToken, "000000", meta)).rejects.toThrow("locked");
  });

  it("disabling 2FA actually clears the stored secret", async () => {
    const u = await addUser(holder.db, { totpEnabledAt: new Date(), totpSecretEnc: { v: 1 } });
    await disableTotp(u.id, "Correct-Horse-1");
    const after = await holder.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.totpEnabledAt).toBeNull();
    expect(after.totpSecretEnc).toBe("__DbNull__");
  });
});

describe("TOTP replay", () => {
  it("accepts a code once, then rejects the same code (and older steps)", async () => {
    const { generateTotpSecret, totpCode } = await import("../src/server/totp");
    const { encryptSecret } = await import("../src/server/crypto");
    const secret = generateTotpSecret();
    const u = await addUser(holder.db, { totpEnabledAt: new Date(), totpLastStep: null });
    await holder.db.user.update({ where: { id: u.id }, data: { totpSecretEnc: encryptSecret(secret, `totp:${u.id}`) } });
    const code = totpCode(secret);

    await expect(completeMfaLogin(signToken("mfa", u.id, 300), code, meta)).resolves.toMatchObject({ userId: u.id });
    await expect(completeMfaLogin(signToken("mfa", u.id, 300), code, meta)).rejects.toThrow("Incorrect");

    const previous = totpCode(secret, Math.floor(Date.now() / 30_000) - 1);
    await expect(completeMfaLogin(signToken("mfa", u.id, 300), previous, meta)).rejects.toThrow("Incorrect");
  });
});

describe("password reset codes", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mail = require("../src/server/mail") as { sendMail: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forgotPassword, resetPassword } = require("../src/server/services/auth.service") as typeof import("../src/server/services/auth.service");
  const lastCode = () => /Reset code: (\d{6})/.exec(String(mail.sendMail.mock.calls.at(-1)?.[0]?.text))?.[1] ?? "";
  const wrong = (code: string, i: number) => String((Number(code) - 100000 + 1 + i) % 900000 + 100000);

  beforeEach(() => mail.sendMail.mockClear());

  it("parallel wrong guesses can't get past the 5-attempt limit", async () => {
    await addUser(holder.db);
    await forgotPassword("a@example.com");
    const code = lastCode();
    await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => resetPassword({ email: "a@example.com", code: wrong(code, i), newPassword: "Another-Pass-77" }, null)),
    );
    // the attempts are spent, so even the right code no longer works
    await expect(resetPassword({ email: "a@example.com", code, newPassword: "Another-Pass-77" }, null)).rejects.toThrow(/too many attempts|expired/i);
  });

  it("a new code cancels the previous one", async () => {
    await addUser(holder.db);
    await forgotPassword("a@example.com");
    const first = lastCode();
    await forgotPassword("a@example.com");
    const second = lastCode();
    if (first !== second) {
      await expect(resetPassword({ email: "a@example.com", code: first, newPassword: "Another-Pass-77" }, null)).rejects.toThrow();
    }
    await expect(resetPassword({ email: "a@example.com", code: second, newPassword: "Another-Pass-77" }, null)).resolves.toBeUndefined();
  });

  it("caps issuance at 5 codes an hour, silently", async () => {
    await addUser(holder.db);
    for (let i = 0; i < 7; i++) await expect(forgotPassword("a@example.com")).resolves.toEqual({ sent: true });
    expect(mail.sendMail).toHaveBeenCalledTimes(5);
  });
});
