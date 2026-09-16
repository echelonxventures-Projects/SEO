import { z } from "zod";

export const idParam = z.string().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(60).optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function skipTake(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

/** Returns the value only if it is one of the enum members (for Prisma where-filters). */
export function enumFilter<E extends string>(
  value: string | null | undefined,
  allowed: readonly E[],
): E | undefined {
  return allowed.includes((value ?? "") as E) ? (value as E) : undefined;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("A valid email is required")
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[0-9]/, "Must contain a digit")
  .regex(/[^a-zA-Z0-9]/, "Must contain a special character");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "2–40 chars: lowercase letters, digits, hyphens");

export const moneySchema = z
  .number()
  .nonnegative("Amount cannot be negative")
  .finite()
  .max(20_000_000_000, "Amount exceeds supported maximum"); // in major units

export const qtySchema = z
  .number()
  .positive("Quantity must be positive")
  .max(1_000_000, "Quantity too large");

export const bpsSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000);

export const dateSchema = z.union([
  z.string().datetime(),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((s) => `${s}T00:00:00.000Z`),
]);

export const nameish = z.string().trim().min(1).max(160);
export const longText = z.string().trim().max(8000);
export const urlish = z.string().trim().url().max(2000);

export const phoneish = z.string().trim().max(32);
export const codeish = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_.:/#-]{1,32}$/);
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{3}[A-Z]{1}$/, "Invalid GSTIN format");

export const activeSchema = z.object({ active: z.boolean() });

export const categoryListSchema = z.object({
  kind: z.enum(["SERVICE", "INDUSTRY", "LEAD_SOURCE", "EXPENSE_TYPE", "CAMPAIGN_CHANNEL", "PROJECT_TYPE"]),
});
