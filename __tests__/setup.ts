import { db } from "../db";

// Mock Prisma client for unit tests
export const mockDb = {
  $transaction: jest.fn((fn) => fn(mockDb)),
  invoice: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  subscription: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  billingCycle: {
    create: jest.fn(),
    update: jest.fn(),
  },
  gatewayConfig: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  plan: {
    findFirst: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
};

jest.mock("../db", () => ({
  db: mockDb,
}));

jest.mock("../crypto", () => ({
  decryptSecret: jest.fn((enc) => JSON.stringify({ keyId: "test-key", keySecret: "test-secret" })),
  encryptSecret: jest.fn((val) => `encrypted:${val}`),
  randomToken: jest.fn((n) => `token_${n}`),
}));

jest.mock("../tokens", () => ({
  signToken: jest.fn((purpose, payload, expiry) => `signed:${payload}`),
  verifyToken: jest.fn((purpose, token) => ({ s: "invoice_123" })),
}));

jest.mock("../numbering", () => ({
  nextDocumentNumber: jest.fn(() => "INV-2024-0001"),
}));

jest.mock("../errors", () => ({
  AppError: class AppError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
  ErrorCodes: {
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    FORBIDDEN: "FORBIDDEN",
    PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
    WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  },
}));

jest.mock("../audit", () => ({
  audit: jest.fn(),
}));

jest.mock("../env", () => ({
  getEnv: jest.fn(() => ({ APP_URL: "http://localhost:3000" })),
}));
