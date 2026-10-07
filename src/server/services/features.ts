import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import type { Ctx } from "./common";

// Feature flags stored in SystemSetting
const FEATURE_FLAG_KEYS = {
  UTP_ENABLED: "feature_flag.utp_enabled",
  UTP_ADSPOINT: "feature_flag.utp_adspot",
  UTP_WORKFORCE: "feature_flag.utp_workforce",
  UTP_CAPACITY: "feature_flag.utp_capacity",
  UTP_EXTERNAL_CONNECTORS: "feature_flag.utp_external_connectors",
} as const;

export const featureFlagSchema = z.object({
  uTP_ENABLED: z.boolean().default(true),
  UTP_ADSPOT: z.boolean().default(false),
  UTP_WORKFORCE: z.boolean().default(false),
  UTP_CAPACITY: z.boolean().default(false),
  UTP_EXTERNAL_CONNECTORS: z.boolean().default(false),
});

export type FeatureFlags = z.infer<typeof featureFlagSchema>;

/**
 * Check if a feature flag is enabled for the current workspace
 */
export async function isFeatureEnabled(ctx: Ctx, flag: keyof typeof FEATURE_FLAG_KEYS): Promise<boolean> {
  const setting = await db.systemSetting.findUnique({
    where: { key: FEATURE_FLAG_KEYS[flag] },
  });

  // Default to enabled if not set
  if (!setting) return true;

  return setting.value as boolean;
}

/**
 * Set a feature flag for the workspace
 */
export async function setFeatureFlag(
  ctx: Ctx,
  flag: keyof typeof FEATURE_FLAG_KEYS,
  enabled: boolean
): Promise<void> {
  if (ctx.viewer.active.roleCode !== "OWNER" && ctx.viewer.active.roleCode !== "ADMIN") {
    throw new AppError(ErrorCodes.FORBIDDEN, "Only owners/admins can manage feature flags");
  }

  await db.systemSetting.upsert({
    where: { key: FEATURE_FLAG_KEYS[flag] },
    create: {
      key: FEATURE_FLAG_KEYS[flag],
      value: enabled as unknown as Prisma.InputJsonValue,
      valueType: "boolean",
    },
    update: {
      value: enabled as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Check if UTP is enabled for the workspace
 * If not, return early with appropriate error or graceful degradation
 */
export async function requireUTPEnabled(ctx: Ctx): Promise<void> {
  const enabled = await isFeatureEnabled(ctx, "UTP_ENABLED");
  
  if (!enabled) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      "Universal Temporal Platform is not enabled for this workspace. Please upgrade your plan or contact support."
    );
  }
}

/**
 * Get all feature flags for the current workspace
 */
export async function getFeatureFlags(ctx: Ctx): Promise<FeatureFlags> {
  const flags: Record<string, boolean> = {};

  for (const [key, settingKey] of Object.entries(FEATURE_FLAG_KEYS)) {
    const setting = await db.systemSetting.findUnique({
      where: { key: settingKey },
    });

    flags[key] = setting ? (setting.value as boolean) : true;
  }

  return flags as FeatureFlags;
}

/**
 * Get feature flags without context (for settings UI)
 */
export async function getFeatureFlagsForOrg(orgId: string): Promise<FeatureFlags> {
  const flags: Record<string, boolean> = {};

  for (const [key, settingKey] of Object.entries(FEATURE_FLAG_KEYS)) {
    const setting = await db.systemSetting.findUnique({
      where: { key: settingKey },
    });

    flags[key] = setting ? (setting.value as boolean) : true;
  }

  return flags as FeatureFlags;
}
