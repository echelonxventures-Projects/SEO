import type { Prisma } from "@/generated/prisma/client";
import { AppError, ErrorCodes } from "../errors";
import { slugSchema } from "../schemas";

type Tx = Prisma.TransactionClient;

function initials(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Z0-9]/.test(w));
  if (words.length === 0) return "OMNI";
  if (words.length === 1) return words[0].slice(0, 4);
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("");
}

export async function uniqueOrgSlug(tx: Tx, name: string): Promise<string> {
  const base = slugSchema.safeParse(
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32),
  );
  const slug = base.success ? base.data : "org-" + Date.now().toString(36);
  if (slug.length < 2) return `org-${slug}`;
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? slug : `${slug}-${n + 1}`;
    const existing = await tx.organization.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  throw new AppError(ErrorCodes.CONFLICT, "Could not derive a unique workspace URL");
}

export const ORG_DOC_SEQUENCE_DEFAULTS = [
  { kind: "INVOICE", prefixByInitials: true, pattern: "{PREFIX}-INV-{YEAR}{MONTH}-{SEQ}", padding: 4 },
  { kind: "QUOTE", prefixByInitials: true, pattern: "{PREFIX}-EST-{YEAR}{MONTH}-{SEQ}", padding: 4 },
  { kind: "PAYMENT", prefixByInitials: true, pattern: "{PREFIX}-PMT-{YEAR}{MONTH}-{SEQ}", padding: 4 },
] as const;

export const ORG_PIPELINE_DEFAULTS = [
  { code: "NEW", name: "New", winProbabilityBps: 0, sortOrder: 1 },
  { code: "CONTACTED", name: "Contacted", winProbabilityBps: 1000, sortOrder: 2 },
  { code: "QUALIFIED", name: "Qualified", winProbabilityBps: 3000, sortOrder: 3 },
  { code: "PROPOSAL_SENT", name: "Proposal sent", winProbabilityBps: 6000, sortOrder: 4 },
  { code: "WON", name: "Won", winProbabilityBps: 10000, sortOrder: 5, isTerminalWon: true },
  { code: "LOST", name: "Lost", winProbabilityBps: 0, sortOrder: 6, isTerminalLost: true },
] as const;

/**
 * Bootstrap data every organization needs to be operational from second one:
 * document numbering, lead pipeline, owner membership. All values are derived
 * from the org entity itself (initials → invoice prefix) — no magic constants.
 */
export async function bootstrapOrganization(
  tx: Tx,
  org: { id: string; name: string; defaultCurrencyCode: string },
): Promise<void> {
  const prefix = initials(org.name);
  for (const seq of ORG_DOC_SEQUENCE_DEFAULTS) {
    await tx.documentSequence.create({
      data: {
        orgId: org.id,
        kind: seq.kind,
        pattern: seq.pattern,
        prefix,
        padding: seq.padding,
      },
    });
  }
  for (const stage of ORG_PIPELINE_DEFAULTS) {
    await tx.pipelineStage.create({ data: { orgId: org.id, ...stage } });
  }
}

export async function getRoleByCode(tx: Tx, code: string) {
  const role = await tx.role.findUnique({ where: { code } });
  if (!role) throw new AppError(ErrorCodes.INTERNAL, `Role ${code} missing from catalog`);
  return role;
}

