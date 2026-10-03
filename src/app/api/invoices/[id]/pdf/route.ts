import { withActor, fileResponse } from "@/lib/http";
import { getInvoice } from "@/server/billing";
import { invoicePdf } from "@/server/pdf";
import { notFound } from "@/lib/errors";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const data = await getInvoice(actor, id);
    if (actor.role === "client" && data.invoice.status === "draft") throw notFound();
    const pdf = await invoicePdf(data as never);
    return fileResponse(Buffer.from(pdf), `${data.invoice.number}.pdf`, "application/pdf", true);
  });
}
