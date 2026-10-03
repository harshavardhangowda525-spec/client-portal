/** All arithmetic is done in integer paise to avoid floating-point drift. */
export const toPaise = (rupees: number) => Math.round(Number(rupees) * 100);
export const fromPaise = (paise: number) => Math.round(paise) / 100;

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** PDF standard fonts cannot render ₹, so PDFs use the ISO code. */
export function formatMoneyPlain(amount: number, currency = "INR"): string {
  return `${currency} ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

export type LineInput = { quantity: number; unitPrice: number };
export type PaymentTermInput = { label: string; percent: number; due: string };
export type Totals = {
  lineAmounts: number[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
};

export function computeTotals(
  items: LineInput[],
  discountType: "none" | "percent" | "amount",
  discountValue: number,
  taxRate: number,
): Totals {
  const linePaise = items.map((i) => Math.round(toPaise(i.unitPrice) * Number(i.quantity)));
  const sub = linePaise.reduce((a, b) => a + b, 0);
  let disc = 0;
  if (discountType === "percent") disc = Math.round((sub * Math.min(discountValue, 100)) / 100);
  if (discountType === "amount") disc = Math.min(toPaise(discountValue), sub);
  const taxable = sub - disc;
  const tax = Math.round((taxable * taxRate) / 100);
  return {
    lineAmounts: linePaise.map(fromPaise),
    subtotal: fromPaise(sub),
    discountAmount: fromPaise(disc),
    taxAmount: fromPaise(tax),
    total: fromPaise(taxable + tax),
  };
}

/** Split the total across payment terms by percentage; the last term absorbs rounding. */
export function splitPaymentTerms(total: number, terms: PaymentTermInput[]) {
  const totalPaise = toPaise(total);
  let allocated = 0;
  return terms.map((t, idx) => {
    const amount = idx === terms.length - 1 ? totalPaise - allocated : Math.round((totalPaise * t.percent) / 100);
    allocated += amount;
    return { label: t.label, percent: t.percent, due: t.due, amount: fromPaise(amount) };
  });
}
