import { db } from "../db";

// Mock Prisma client for unit tests
export const mockDb = {
  $transaction: jest.fn((fn) => fn(mockDb)),
  invoice: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  webhookEvent: {
    create: jest.fn(),
    update: jest.fn(),
  },
  payment: {
    findFirst: jest.fn(),
  },
};

jest.mock("../db", () => ({ db: mockDb }));

jest.mock("../errors", () => ({
  AppError: class AppError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
  ErrorCodes: {
    WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  },
}));
