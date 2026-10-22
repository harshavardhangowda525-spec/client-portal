import { requireClient } from "@/lib/session";
import { listDocuments } from "@/server/content";
import { listProjectProposals } from "@/server/proposals";
import { getBilling } from "@/server/billing";
import { PageHead, Panel } from "@/components/ui";
import { DocumentLibrary } from "@/components/views/documents";
import { UploadForm } from "@/components/views/upload-form";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const [docs, proposals, billing] = await Promise.all([listDocuments(actor, projectId), listProjectProposals(actor, projectId), getBilling(actor, projectId)]);
  return (
    <>
      <PageHead eyebrow="Secure files" title="Documents" sub="All files are private to your project and require you to be signed in." />
      <DocumentLibrary docs={docs} proposals={proposals} invoices={billing.invoices} payments={billing.payments} />
      <Panel title="Share files with us" sub="Logos, photos, menus or any brand material (max 15 MB each)." className="section">
        <UploadForm projectId={projectId} categories={[["brand_asset", "Brand asset"], ["requirements", "Requirements"], ["other", "Other"]]} />
      </Panel>
    </>
  );
}
