import { getActor } from "@/lib/session";
import { fileResponse } from "@/lib/http";
import { getProposal, recordProposalView } from "@/server/proposals";
import { proposalPdf } from "@/server/pdf";
import { pdfBrand } from "@/server/pricing";
import { AppError } from "@/lib/errors";

function errorPage(status: number, message: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF unavailable</title>
<style>body{font-family:system-ui,sans-serif;background:#050a18;color:#f4f7ff;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
div{max-width:440px;text-align:center}p{color:#a9b3c9}a{color:#6aa8ff}</style></head><body><div><h1>We couldn't create this PDF</h1><p>${message}</p>
<p><a href="javascript:history.back()">Go back</a></p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) return errorPage(401, "Please sign in to download this proposal.");
  let data: Awaited<ReturnType<typeof getProposal>>;
  try {
    data = await getProposal(actor, id, new URL(req.url).searchParams.get("v"));
  } catch (e) {
    if (e instanceof AppError) return errorPage(404, "This proposal was not found, or you do not have access to it.");
    throw e;
  }
  try {
    const bytes = await proposalPdf({ number: data.proposal.number, title: data.proposal.title, client: data.client }, data.version as never, data.items as never, data.acceptance, await pdfBrand());
    if (actor.role === "client") await recordProposalView(actor, data.version.id);
    return fileResponse(Buffer.from(bytes), `${data.proposal.number}-v${data.version.version_no}.pdf`, "application/pdf", true);
  } catch (e) {
    console.error("[proposal pdf]", e);
    return errorPage(500, "Something went wrong while generating the PDF. Please try again, or view the proposal online.");
  }
}
