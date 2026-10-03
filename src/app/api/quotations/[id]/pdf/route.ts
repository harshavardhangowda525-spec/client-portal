import { withActor, fileResponse } from "@/lib/http";
import { getVersion } from "@/server/quotations";
import { quotationPdf } from "@/server/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const { version, items, acceptance } = await getVersion(actor, id);
    const pdf = await quotationPdf(version, items, acceptance);
    return fileResponse(Buffer.from(pdf), `${version.number}-v${version.version_no}.pdf`, "application/pdf", true);
  });
}
