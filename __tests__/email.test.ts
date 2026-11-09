import { createFakeDb, type FakeDb } from "./fake-db";

const holder: { db: FakeDb } = { db: createFakeDb() };
jest.mock("../src/server/db", () => ({
  get db() {
    return holder.db;
  },
}));
jest.mock("../src/generated/prisma/client", () => ({ Prisma: {} }));
const sent: Array<{ to: string; headers?: Record<string, string>; text: string }> = [];
jest.mock("../src/server/mail", () => ({
  sendMail: jest.fn(async (m: { to: string; headers?: Record<string, string>; text: string }) => {
    await new Promise((r) => setTimeout(r, 5)); // SMTP latency: lets overlapping runs interleave
    sent.push(m);
  }),
}));

Object.assign(process.env, {
  DATABASE_URL: "postgresql://x:y@localhost:5432/z",
  APP_URL: "https://app.example",
  OMNI_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 7).toString("base64") }),
  OMNI_TOKEN_SECRET: "t".repeat(40),
});

import { runEmailDispatcher } from "../src/server/services/email.service";

async function seedCampaign(db: FakeDb, recipients: number) {
  const org = await db.organization.create({ data: { name: "Acme" } });
  const campaign = await db.emailCampaign.create({
    data: {
      status: "SENDING", scheduledAt: null, subject: "Hello", preheader: null, bodyMarkdown: "Hi there,",
      fromName: null, fromEmail: null, sentCount: 0, failedCount: 0,
      list: { name: "News", orgId: org.id },
    },
  });
  for (let i = 0; i < recipients; i++) {
    await db.emailSend.create({
      data: {
        campaignId: campaign.id, subscriberId: `sub_${i}`, status: "PENDING", attempts: 0, claimedAt: null,
        subscriber: { email: `r${i}@example.com`, name: null, status: "SUBSCRIBED" },
      },
    });
  }
  return campaign;
}

beforeEach(() => {
  holder.db = createFakeDb();
  sent.length = 0;
});

describe("email dispatcher", () => {
  it("overlapping runs deliver each send exactly once", async () => {
    await seedCampaign(holder.db, 6);
    await Promise.all([runEmailDispatcher(), runEmailDispatcher()]);
    const recipients = sent.map((m) => m.to).sort();
    expect(recipients).toEqual([0, 1, 2, 3, 4, 5].map((i) => `r${i}@example.com`).sort());
  });

  it("sends RFC 8058 one-click unsubscribe headers and a text-part link", async () => {
    await seedCampaign(holder.db, 1);
    await runEmailDispatcher();
    const [m] = sent;
    expect(m.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\/api\/v1\/public\/unsubscribe\/.+>$/);
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.text).toContain("https://app.example/unsubscribe/");
  });
});
