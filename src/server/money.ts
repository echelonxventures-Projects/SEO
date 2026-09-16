export const QTY_SCALE = 100n;
export const BPS = 10_000n;

export const MAX_QTY_HUNDREDTHS = 1_000_000_00;
export const MAX_MINOR_UNITS = 2_000_000_000_000_000n;

export function toMinor(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Monetary amounts must be finite and non-negative");
  }
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Monetary amount exceeds safe integer range");
  }
  return BigInt(minor);
}

export function minorToNumber(minor: bigint): number {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount exceeds safe serialization range");
  }
  return Number(minor);
}

/** Positive half-up integer division (all domain amounts are non-negative). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("division by zero");
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r * 2n >= denominator) return q + 1n;
  return q;
}

export function bpsApply(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error("basis points out of range: " + bps);
  }
  return divRound(amount * BigInt(bps), BPS);
}

export type LineInput = {
  unitPriceMinor: bigint;
  qtyHundredths: number;
  discountBps: number;
  taxBps: number;
};

export type LineComputed = {
  grossMinor: bigint;
  discountMinor: bigint;
  lineTotalMinor: bigint;
  taxMinor: bigint;
};

export function computeLine(l: LineInput): LineComputed {
  if (!Number.isInteger(l.qtyHundredths) || l.qtyHundredths < 0 || l.qtyHundredths > MAX_QTY_HUNDREDTHS) {
    throw new Error("quantity out of range");
  }
  if (l.unitPriceMinor < 0n || l.unitPriceMinor > MAX_MINOR_UNITS) {
    throw new Error("unit price out of range");
  }
  const grossMinor = divRound(l.unitPriceMinor * BigInt(l.qtyHundredths), QTY_SCALE);
  const discountMinor = bpsApply(grossMinor, l.discountBps);
  const lineTotalMinor = grossMinor - discountMinor;
  const taxMinor = bpsApply(lineTotalMinor, l.taxBps);
  return { grossMinor, discountMinor, lineTotalMinor, taxMinor };
}

export type TaxComponent = {
  code: string;
  name: string;
  bps: number;
};

/**
 * Split tax across components (e.g. CGST + SGST) so the parts sum EXACTLY to
 * the tax computed at the combined rate. Each component's exact share of the
 * base is `base * componentBps / BPS`; we take the floor of each and hand the
 * leftover (total − sum of floors) to the largest fractional remainders.
 */
export function splitTaxAcrossComponents(
  base: bigint,
  combinedBps: number,
  components: TaxComponent[],
): bigint[] {
  if (components.length === 0) return [];
  const totalTax = bpsApply(base, combinedBps);
  const numerators = components.map((c) => base * BigInt(c.bps));
  const parts = numerators.map((n) => n / BPS);
  const fracs = numerators.map((n) => n % BPS);
  let remainder = totalTax - parts.reduce((a, b) => a + b, 0n);
  const order = fracs
    .map((f, idx) => ({ idx, f }))
    .sort((x, y) => Number(y.f - x.f));
  let i = 0;
  while (remainder > 0n && order.length > 0) {
    parts[order[i % order.length].idx] += 1n;
    remainder -= 1n;
    i += 1;
  }
  return parts;
}

export type DocumentLine = {
  line: LineComputed;
  taxBps: number;
  components: TaxComponent[];
};

export type DocTotals = {
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  taxBreakdown: Array<{
    code: string;
    name: string;
    bps: number;
    baseMinor: bigint;
    taxMinor: bigint;
  }>;
};

/**
 * Compute document totals from lines only. `documentDiscountMinor` is an
 * explicit post-tax adjustment shown on the face of the document.
 */
export function computeDocument(
  lines: DocumentLine[],
  documentDiscountMinor: bigint,
): DocTotals {
  if (documentDiscountMinor < 0n) throw new Error("document discount cannot be negative");
  let subtotal = 0n;
  let tax = 0n;
  const breakdown = new Map<
    string,
    { code: string; name: string; bps: number; baseMinor: bigint; taxMinor: bigint }
  >();

  for (const { line, taxBps, components } of lines) {
    subtotal += line.lineTotalMinor;
    const effective =
      components.length > 0 || taxBps === 0
        ? components
        : [{ code: "TAX", name: "Tax", bps: taxBps }]; // derived from the line's own tax-rate snapshot
    const parts = splitTaxAcrossComponents(line.lineTotalMinor, taxBps, effective);
    const lineTax = parts.reduce((a, b) => a + b, 0n);
    if (lineTax !== line.taxMinor) {
      throw new Error(
        "line tax inconsistent with components: caller must pass components summing to line taxBps",
      );
    }
    effective.forEach((c, ci) => {
      const entry =
        breakdown.get(c.code) ??
        { code: c.code, name: c.name, bps: c.bps, baseMinor: 0n, taxMinor: 0n };
      entry.baseMinor += line.lineTotalMinor;
      entry.taxMinor += parts[ci];
      breakdown.set(c.code, entry);
    });
    tax += lineTax;
  }

  if (subtotal + tax > MAX_MINOR_UNITS * 10n) {
    throw new Error("document total exceeds supported maximum");
  }
  const raw = subtotal + tax - documentDiscountMinor;
  const total = raw < 0n ? 0n : raw;

  return {
    subtotalMinor: subtotal,
    taxMinor: tax,
    totalMinor: total,
    taxBreakdown: [...breakdown.values()],
  };
}
