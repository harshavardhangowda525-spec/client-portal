import { withActor, fileResponse } from "@/lib/http";
import { getPayment } from "@/server/billing";
import { receiptPdf } from "@/server/pdf";
import { AppError } from "@/lib/errors";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const data = await getPayment(actor, id);
    if (data.payment.status !== "confirmed" || !data.payment.receipt_number) throw new AppError("A receipt is available once the payment is confirmed.");
    const pdf = await receiptPdf(data as never);
    return fileResponse(Buffer.from(pdf), `${data.payment.receipt_number}.pdf`, "application/pdf", true);
  });
}
