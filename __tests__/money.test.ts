import { mockDb } from "../setup";
import { computeLine, computeDocument, splitTaxAcrossComponents, resolveTax } from "../../src/server/money";

describe("Money & Tax Engine", () => {
  describe("computeLine", () => {
    it("should calculate line total correctly", () => {
      const result = computeLine(
        BigInt(10000), // price minor (100.00)
        150,           // qty hundredths (1.50)
        0,             // discount bps
        0,             // tax bps
      );

      expect(result.lineTotalMinor).toBe(BigInt(15000)); // 100.00 * 1.50
      expect(result.taxMinor).toBe(BigInt(0));
    });

    it("should apply line discounts", () => {
      const result = computeLine(
        BigInt(10000),
        100,
        1000, // 10% discount
        0,
      );

      expect(result.lineTotalMinor).toBe(BigInt(9000));
      expect(result.discountMinor).toBe(BigInt(1000));
    });

    it("should calculate tax correctly", () => {
      const result = computeLine(
        BigInt(10000),
        100,
        0,
        1800, // 18% tax
      );

      expect(result.taxMinor).toBe(BigInt(1800));
    });
  });

  describe("computeDocument", () => {
    it("should sum line totals and apply document discount", () => {
      const lines = [
        { lineTotalMinor: BigInt(10000), discountMinor: BigInt(0), taxMinor: BigInt(1800) },
        { lineTotalMinor: BigInt(5000), discountMinor: BigInt(0), taxMinor: BigInt(900) },
      ];

      const result = computeDocument(lines, BigInt(500), 0);

      expect(result.subtotalMinor).toBe(BigInt(15000));
      expect(result.discountMinor).toBe(BigInt(500));
      expect(result.taxMinor).toBe(BigInt(2700));
      expect(result.totalMinor).toBe(BigInt(17200));
    });

    it("should handle document-level discounts", () => {
      const lines = [
        { lineTotalMinor: BigInt(10000), discountMinor: BigInt(0), taxMinor: BigInt(1800) },
      ];

      const result = computeDocument(lines, BigInt(0), BigInt(1000));

      expect(result.discountMinor).toBe(BigInt(1000));
    });
  });

  describe("splitTaxAcrossComponents", () => {
    it("should split tax equally for CGST/SGST", () => {
      const result = splitTaxAcrossComponents(BigInt(1800), "GST_INTRA");

      expect(result.cgstMinor).toBe(BigInt(900));
      expect(result.sgstMinor).toBe(BigInt(900));
      expect(result.cgstMinor + result.sgstMinor).toBe(BigInt(1800)); // Must sum exactly
    });

    it("should handle IGST (no split)", () => {
      const result = splitTaxAcrossComponents(BigInt(1800), "GST_INTER");

      expect(result.igstMinor).toBe(BigInt(1800));
    });

    it("should use largest-remainder for odd amounts", () => {
      const result = splitTaxAcrossComponents(BigInt(1001), "GST_INTRA");

      // Should sum exactly to original amount
      expect(result.cgstMinor + result.sgstMinor).toBe(BigInt(1001));
      // One gets 500, other gets 501 (largest remainder)
      expect(Math.abs(Number(result.cgstMinor) - Number(result.sgstMinor))).toBeLessThanOrEqual(1);
    });
  });

  describe("resolveTax", () => {
    it("should return intra-state tax for same state", () => {
      const result = resolveTax(
        "KA", // org state
        "KA", // client state
        false // taxExempt
      );

      expect(result.kind).toBe("GST_INTRA");
    });

    it("should return inter-state tax for different states", () => {
      const result = resolveTax(
        "KA",
        "TN",
        false
      );

      expect(result.kind).toBe("GST_INTER");
    });

    it("should return 0 rate for tax-exempt clients", () => {
      const result = resolveTax("KA", "KA", true);

      expect(result.rateBps).toBe(0);
    });
  });

  describe("tax snapshots", () => {
    it("should preserve historical tax rates", () => {
      const orgState = "KA";
      const clientState = "KA";
      const orgRate = resolveTax(orgState, clientState, false);

      // Even if org later changes state, old invoices keep original rate
      const snapshot = {
        bps: orgRate.rateBps,
        kind: orgRate.kind,
      };

      expect(snapshot.bps).toBe(1800);
      expect(snapshot.kind).toBe("GST_INTRA");
    });
  });
});
