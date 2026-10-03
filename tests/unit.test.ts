import { describe, it, expect } from "vitest";
import { computeTotals, splitPaymentTerms } from "@/lib/money";
import { computeProgress, isOverdue } from "@/lib/progress";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/server/razorpay";
import { hmacSha256Hex, hashPassword, verifyPassword, stableStringify } from "@/lib/crypto";
import { effectiveStatus } from "@/server/quotations";

describe("money", () => {
  it("computes totals with discount and tax in paise", () => {
    const t = computeTotals([{ quantity: 1, unitPrice: 12000 }, { quantity: 3, unitPrice: 333.33 }], "percent", 10, 18);
    expect(t.subtotal).toBe(12999.99);
    expect(t.discountAmount).toBe(1300);
    expect(t.taxAmount).toBe(2106);
    expect(t.total).toBe(13805.99);
  });
  it("caps a fixed discount at the subtotal", () => {
    expect(computeTotals([{ quantity: 1, unitPrice: 100 }], "amount", 500, 0).total).toBe(0);
  });
  it("splits payment terms with the last term absorbing rounding", () => {
    const s = splitPaymentTerms(1000.01, [{ label: "A", percent: 33.33, due: "" }, { label: "B", percent: 66.67, due: "" }]);
    expect(s[0].amount + s[1].amount).toBeCloseTo(1000.01, 2);
  });
});

describe("progress", () => {
  it("uses milestone weights, counting only completed milestones", () => {
    expect(computeProgress([
      { status: "completed", weight: 20 }, { status: "in_progress", weight: 30 }, { status: "not_started", weight: 50 },
    ])).toBe(20);
    expect(computeProgress([])).toBe(0);
  });
  it("flags overdue milestones that are not completed", () => {
    expect(isOverdue({ status: "in_progress", due_date: "2020-01-01" }, "2026-01-01")).toBe(true);
    expect(isOverdue({ status: "completed", due_date: "2020-01-01" }, "2026-01-01")).toBe(false);
  });
});

describe("quotation status", () => {
  it("treats sent quotations past their expiry date as expired", () => {
    expect(effectiveStatus({ status: "sent", valid_until: "2020-01-01" }, "2026-01-01")).toBe("expired");
    expect(effectiveStatus({ status: "accepted", valid_until: "2020-01-01" }, "2026-01-01")).toBe("accepted");
  });
});

describe("crypto", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("CorrectHorse1");
    expect(await verifyPassword("CorrectHorse1", h)).toBe(true);
    expect(await verifyPassword("WrongHorse1", h)).toBe(false);
  });
  it("produces stable JSON regardless of key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
  });
});

describe("razorpay signatures", () => {
  it("verifies checkout signatures with the key secret", () => {
    const sig = hmacSha256Hex("secret", "order_1|pay_1");
    expect(verifyCheckoutSignature("order_1", "pay_1", sig, "secret")).toBe(true);
    expect(verifyCheckoutSignature("order_1", "pay_2", sig, "secret")).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_1", sig, "")).toBe(false);
  });
  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect(verifyWebhookSignature(body, hmacSha256Hex("wh", body), "wh")).toBe(true);
    expect(verifyWebhookSignature(body + " ", hmacSha256Hex("wh", body), "wh")).toBe(false);
  });
});
