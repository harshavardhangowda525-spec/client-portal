import { requireAdmin } from "@/lib/session";
import { listDocuments } from "@/server/content";
import { listProjectQuotations } from "@/server/quotations";
import { getBilling } from "@/server/billing";
import { Panel } from "@/components/ui";
import { DocumentLibrary } from "@/components/views/documents";
import { UploadForm } from "@/components/views/upload-form";
import { DeleteDoc } from "./delete";
import { DOC_CATEGORIES } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminDocuments({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const [docs, quotes, billing] = await Promise.all([listDocuments(actor, projectId), listProjectQuotations(actor, projectId), getBilling(actor, projectId)]);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <DocumentLibrary docs={docs} quotes={quotes} invoices={billing.invoices} payments={billing.payments} admin renderActions={(d) => <DeleteDoc id={d.id} name={d.name} />} />
      <Panel title="Upload a document" sub="Files are private. Clients download them only while signed in.">
        <UploadForm projectId={projectId} categories={Object.entries(DOC_CATEGORIES).filter(([k]) => k !== "quotation" && k !== "invoice") as [string, string][]}
          extra={<div className="field full"><label htmlFor="vis">Visibility</label><select id="vis" name="visibility" className="select"><option value="client">Shared with client</option><option value="internal">Internal only</option></select></div>} />
      </Panel>
    </div>
  );
}
