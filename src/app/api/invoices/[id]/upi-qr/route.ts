import QRCode from "qrcode";
import { withActor } from "@/lib/http";
import { getInvoice } from "@/server/billing";
import { getPaymentDetails, upiLink } from "@/server/maintenance";
import { notFound } from "@/lib/errors";

/** Scan-to-pay UPI QR code (SVG) for the invoice's outstanding balance. Only for people who can see the invoice. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const data = await getInvoice(actor, id);
    if (!["issued", "partially_paid"].includes(data.invoice.status) || data.balance <= 0) throw notFound();
    const pd = await getPaymentDetails();
    if (!pd.upi_id) throw notFound();
    const svg = await QRCode.toString(upiLink(pd, data.balance, `${data.invoice.number} ${data.project.name}`, data.invoice.number),
      { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 240, color: { dark: "#000000", light: "#ffffff" } });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  });
}
