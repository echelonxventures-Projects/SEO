import { db } from "./db";

/**
 * Atomic token-bucket rate limiter stored in the database.
 * Capacity = requests-per-minute, refill = capacity / 60 per second.
 */
export async function consumeBucket(
  bucketKey: string,
  capacityPerMinute: number,
  cost = 1,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const refillPerSec = capacityPerMinute / 60;
  const rows = await db.$queryRaw<{ tokens: number; max: number }[]>`
    INSERT INTO "RateLimitBucket" (id, "bucketKey", tokens, "maxTokens", "refillPerSec", "updatedAt")
    VALUES (gen_random_uuid()::text, ${bucketKey}, ${capacityPerMinute - cost}, ${capacityPerMinute}, ${refillPerSec}, now())
    ON CONFLICT ("bucketKey") DO UPDATE SET
      tokens = LEAST(
        ${capacityPerMinute},
        "RateLimitBucket".tokens
          + EXTRACT(EPOCH FROM (now() - "RateLimitBucket"."updatedAt")) * "RateLimitBucket"."refillPerSec"
      ) - ${cost},
      "maxTokens" = ${capacityPerMinute},
      "refillPerSec" = ${refillPerSec},
      "updatedAt" = now()
    RETURNING tokens, "maxTokens" AS max
  `;
  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  if (row.tokens >= 0) return { allowed: true, retryAfterSeconds: 0 };
  const deficit = cost - row.tokens;
  const retryAfterSeconds = Math.ceil(deficit / refillPerSec);
  return { allowed: false, retryAfterSeconds };
}
