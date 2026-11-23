/**
 * UPI deep link (NPCI format) encoded in scan-to-pay QR codes and used by the "Open UPI app" button.
 * No transaction reference (`tr`) is added: several UPI apps refuse `tr` on personal (non-merchant) UPI IDs.
 */
export function upiLink(d: { upi_id: string; payee_name: string }, amount: number, note: string) {
  const q = new URLSearchParams({ pa: d.upi_id, pn: d.payee_name, am: amount.toFixed(2), cu: "INR", tn: note.slice(0, 80) });
  return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
}
