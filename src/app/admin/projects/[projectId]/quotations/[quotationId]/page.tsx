import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { listProjectQuotations, getVersion } from "@/server/quotations";
import { Panel, QuoteBadge } from "@/components/ui";
import { ActionButton, ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { QuotationDocument } from "@/components/views/quotation-doc";
import { QuoteEditor } from "./editor";
import { SendQuote, SaveTemplate } from "./send";
import { reviseQuotationAction, withdrawVersionAction, deleteDraftAction } from "@/app/actions/admin";
import { company, integrations } from "@/lib/config";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function QuotationDetail({ params, searchParams }: { params: Promise<{ projectId: string; quotationId: string }>; searchParams: Promise<{ v?: string }> }) {
  const actor = await requireAdmin();
  const { projectId, quotationId } = await params;
  const { v } = await searchParams;
  const q = (await listProjectQuotations(actor, projectId)).find((x) => x.id === quotationId);
  if (!q) notFound();
  const meta = q.versions.find((x) => x.id === v) ?? q.versions[0];
  const { version, items, acceptance } = await getVersion(actor, meta.id);
  const isLatest = q.versions[0].id === version.id;
  const base = `/admin/projects/${projectId}/quotations/${quotationId}`;

  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        {version.status === "draft" ? (
          <QuoteEditor versionId={version.id} initial={{ ...version, items }} />
        ) : (
          <>
            <div className="notice info">Version {version.version_no} has been sent and can no longer be edited.{version.status === "accepted" ? " Accepted versions are preserved permanently." : ""} Create a revised version to make changes.</div>
            <QuotationDocument v={version} items={items} acceptance={acceptance} companyName={company().name} />
          </>
        )}
      </div>
      <div className="stack" style={{ position: "sticky", top: 80 }}>
        <Panel title={`${q.number} · v${version.version_no}`} actions={<QuoteBadge status={version.status} />}>
          <dl className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div><dt>Sent</dt><dd className="small">{version.sent_at ? fmtDateTime(version.sent_at) : "—"}</dd></div>
            <div><dt>First viewed</dt><dd className="small">{version.first_viewed_at ? fmtDateTime(version.first_viewed_at) : "—"}</dd></div>
            <div><dt>Views</dt><dd className="small">{version.view_count}</dd></div>
            <div><dt>Expires</dt><dd className="small">{fmtDate(version.valid_until)}</dd></div>
          </dl>
          {version.client_response_note && <div className="notice warn" style={{ marginTop: 12 }}><strong>Client note:</strong> <span className="pre">{version.client_response_note}</span></div>}
          {acceptance && <div className="notice success" style={{ marginTop: 12 }}>Accepted by {acceptance.signer_name} ({acceptance.user_email}) on {fmtDateTime(acceptance.accepted_at)}{acceptance.ip ? ` from ${acceptance.ip}` : ""}.</div>}
          <hr />
          <div className="stack">
            {version.status === "draft" && <SendQuote versionId={version.id} emailConfigured={integrations().email} />}
            {isLatest && version.status !== "draft" && (
              <ActionButton action={reviseQuotationAction.bind(null, quotationId)} className="btn btn-block"><Icon name="edit" /> Create revised version</ActionButton>
            )}
            {["sent", "viewed", "changes_requested"].includes(version.status) && (
              <ActionButton action={withdrawVersionAction.bind(null, version.id)} className="btn btn-ghost btn-block" confirm="Withdraw this quotation? The client will no longer be able to accept it.">Withdraw</ActionButton>
            )}
            <a className="btn btn-block" href={`/api/quotations/${version.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /> {version.status === "draft" ? "Preview PDF" : "Download PDF"}</a>
            {version.status === "draft" && (
              <ActionForm action={deleteDraftAction.bind(null, projectId, version.id)} redirectTo={q.versions.length > 1 ? base : `/admin/projects/${projectId}/quotations`} toast>
                <Submit className="btn btn-ghost btn-block btn-sm" confirm="Delete this draft?"><Icon name="trash" /> Delete draft</Submit>
              </ActionForm>
            )}
            <SaveTemplate versionId={version.id} />
          </div>
        </Panel>
        <Panel title="Versions">
          <div className="list">{q.versions.map((x) => (
            <Link key={x.id} href={`${base}?v=${x.id}`} className="list-item" style={x.id === version.id ? { background: "rgba(61,139,255,.08)" } : undefined}>
              <div className="grow small">Version {x.version_no}<div className="tiny faint">{fmtDate(x.sent_at ?? x.created_at)}</div></div>
              <QuoteBadge status={x.status} />
            </Link>
          ))}</div>
        </Panel>
      </div>
    </div>
  );
}
