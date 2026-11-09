import {
  bpsApply,
  computeDocument,
  computeLine,
  divRound,
  splitTaxAcrossComponents,
  toMinor,
} from "../src/server/money";

const CGST = { code: "CGST", name: "CGST", bps: 900 };
const SGST = { code: "SGST", name: "SGST", bps: 900 };
const IGST = { code: "IGST", name: "IGST", bps: 1800 };

describe("money primitives", () => {
  it("converts major units to paise without float drift", () => {
    expect(toMinor(19.99)).toBe(1999n);
    expect(toMinor(0.1 + 0.2)).toBe(30n);
  });

  it("rejects negative and non-finite amounts", () => {
    expect(() => toMinor(-1)).toThrow();
    expect(() => toMinor(Number.NaN)).toThrow();
    expect(() => toMinor(Infinity)).toThrow();
  });

  it("rounds half-up", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(5n, 3n)).toBe(2n);
    expect(() => divRound(1n, 0n)).toThrow("division by zero");
  });

  it("applies basis points and validates range", () => {
    expect(bpsApply(10_000n, 1800)).toBe(1800n);
    expect(() => bpsApply(100n, 10_001)).toThrow();
    expect(() => bpsApply(100n, 1.5)).toThrow();
  });
});

describe("computeLine", () => {
  it("computes gross, discount, net and tax", () => {
    // 2.5 units × ₹100.00, 10% discount, 18% tax
    const l = computeLine({ unitPriceMinor: 10_000n, qtyHundredths: 250, discountBps: 1000, taxBps: 1800 });
    expect(l).toEqual({ grossMinor: 25_000n, discountMinor: 2_500n, lineTotalMinor: 22_500n, taxMinor: 4_050n });
  });

  it("rejects out-of-range quantity and price", () => {
    expect(() => computeLine({ unitPriceMinor: 1n, qtyHundredths: -1, discountBps: 0, taxBps: 0 })).toThrow("quantity");
    expect(() => computeLine({ unitPriceMinor: -1n, qtyHundredths: 100, discountBps: 0, taxBps: 0 })).toThrow("unit price");
  });
});

describe("splitTaxAcrossComponents (GST)", () => {
  it("CGST + SGST always sum exactly to tax at the combined rate", () => {
    for (const base of [1n, 7n, 333n, 99_999n, 123_457n]) {
      const parts = splitTaxAcrossComponents(base, 1800, [CGST, SGST]);
      expect(parts[0] + parts[1]).toBe(bpsApply(base, 1800));
      expect(parts[0] - parts[1]).toBeLessThanOrEqual(1n); // split stays balanced
    }
  });

  it("IGST takes the whole tax", () => {
    expect(splitTaxAcrossComponents(10_001n, 1800, [IGST])).toEqual([bpsApply(10_001n, 1800)]);
  });

  it("returns nothing for no components", () => {
    expect(splitTaxAcrossComponents(100n, 1800, [])).toEqual([]);
  });
});

describe("computeDocument", () => {
  const line = (unit: bigint, qty: number, taxBps: number, components = [CGST, SGST]) => ({
    line: computeLine({ unitPriceMinor: unit, qtyHundredths: qty, discountBps: 0, taxBps }),
    taxBps,
    components,
  });

  it("totals lines and aggregates the tax breakdown by component", () => {
    const doc = computeDocument([line(10_000n, 100, 1800), line(5_000n, 200, 1800)], 0n);
    expect(doc.subtotalMinor).toBe(20_000n);
    expect(doc.taxMinor).toBe(3_600n);
    expect(doc.totalMinor).toBe(23_600n);
    expect(doc.taxBreakdown).toEqual([
      { code: "CGST", name: "CGST", bps: 900, baseMinor: 20_000n, taxMinor: 1_800n },
      { code: "SGST", name: "SGST", bps: 900, baseMinor: 20_000n, taxMinor: 1_800n },
    ]);
  });

  it("derives a single TAX component when a taxed line has none", () => {
    const doc = computeDocument([line(10_000n, 100, 500, [])], 0n);
    expect(doc.taxBreakdown).toEqual([{ code: "TAX", name: "Tax", bps: 500, baseMinor: 10_000n, taxMinor: 500n }]);
  });

  it("applies document discount after tax and never goes negative", () => {
    expect(computeDocument([line(10_000n, 100, 0, [])], 1_000n).totalMinor).toBe(9_000n);
    expect(computeDocument([line(100n, 100, 0, [])], 1_000n).totalMinor).toBe(0n);
    expect(() => computeDocument([], -1n)).toThrow();
  });

  it("rejects components that don't sum to the line rate", () => {
    expect(() => computeDocument([line(10_000n, 100, 1800, [CGST])], 0n)).toThrow("inconsistent");
  });
});
