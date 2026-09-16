export function fmtMoney(minor: number | string | bigint | null | undefined, symbol = "₹"): string {
  if (minor == null) return "—";
  const n = typeof minor === "bigint" ? Number(minor) : Number(minor);
  if (!Number.isFinite(n)) return "—";
  const major = n / 100;
  const formatted = major.toLocaleString("en-IN", {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN");
}

export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
}

export const statusColors: Record<string, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PAID: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  ACCEPTED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  WON: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  LIVE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PASSED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PASS: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  SENT: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  ISSUED: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  VIEWED: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  IN_PROGRESS: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  DRAFT: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  BACKLOG: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  TODO: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  NEW: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  TRIALING: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  PARTIALLY_PAID: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  OVERDUE: "bg-red-500/15 text-red-600 dark:text-red-400",
  PAST_DUE: "bg-red-500/15 text-red-600 dark:text-red-400",
  FAILED: "bg-red-500/15 text-red-600 dark:text-red-400",
  VOID: "bg-red-500/15 text-red-600 dark:text-red-400",
  DECLINED: "bg-red-500/15 text-red-600 dark:text-red-400",
  LOST: "bg-red-500/15 text-red-600 dark:text-red-400",
  BROKEN: "bg-red-500/15 text-red-600 dark:text-red-400",
  CRITICAL: "bg-red-500/15 text-red-600 dark:text-red-400",
  ERROR: "bg-red-500/15 text-red-600 dark:text-red-400",
  BLOCKED: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  HIGH: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  URGENT: "bg-red-500/15 text-red-600 dark:text-red-400",
  WARNING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  MEDIUM: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  LOW: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  NOTICE: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  CANCELLED: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  EXPIRED: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  ARCHIVED: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  ON_HOLD: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PROSPECT: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  PAUSED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PLANNING: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  SCHEDULED: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  REFUNDED: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  PARTIALLY_REFUNDED: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  CONVERTED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  REMOVED: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

export function statusClass(status: string | null | undefined): string {
  return statusColors[status ?? ""] ?? "bg-zinc-500/15 text-zinc-600";
}
