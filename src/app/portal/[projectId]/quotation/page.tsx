import Link from "next/link";
import { requireClient } from "@/lib/session";
import { listProjectQuotations, getVersion, recordQuotationView } from "@/server/quotations";
import { Empty, PageHead, Panel, QuoteBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { QuotationDocument } from "@/components/views/quotation-doc";
import { QuoteResponse } from "./response";
import { company } from "@/lib/config";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Quotation" };
export const dynamic = "force-dynamic";

export default async function QuotationPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ v?: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const { v: requested } = await searchParams;
  const quotes = await listProjectQuotations(actor, projectId);
  if (quotes.length === 0) {
    return (
      <>
        <PageHead eyebrow="Quotation & proposal" title="Quotation" />
        <div className="glass panel"><Empty icon="file" title="No quotation yet">Your quotation will appear here as soon as it is ready for review.</Empty></div>
      </>
    );
  }
  const all = quotes.flatMap((q) => q.versions.map((v) => ({ ...v, number: q.number, title: q.title })));
  const latestOf = (qid: string) => all.filter((v) => v.quotation_id === qid).sort((a, b) => b.version_no - a.version_no)[0];
  const selectedMeta = all.find((v) => v.id === requested) ?? latestOf(quotes[0].id);
  const { version, items, acceptance, hash } = await getVersion(actor, selectedMeta.id);
  await recordQuotationView(actor, version.id);
  const isLatest = latestOf(version.quotation_id).id === version.id;
  const open = isLatest && ["sent", "viewed", "changes_requested"].includes(version.status);

  return (
    <>
      <PageHead eyebrow="Quotation & proposal" title={`Quotation ${version.number}`} sub={`Version ${version.version_no} · issued ${fmtDate(version.issue_date)}`}
        actions={<a className="btn" href={`/api/quotations/${version.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /> Download PDF</a>} />
      {!isLatest && <div className="notice warn" style={{ marginBottom: 16 }}>You are viewing an older version. <Link href={`?v=${latestOf(version.quotation_id).id}`}>View the latest version</Link>.</div>}
      {version.status === "expired" && <div className="notice error" style={{ marginBottom: 16 }}>This quotation expired on {fmtDate(version.valid_until)}. Please message us for an updated quotation.</div>}
      {version.status === "changes_requested" && <div className="notice info" style={{ marginBottom: 16 }}>You requested changes. We will send a revised version shortly — you can still accept this version if you prefer.</div>}
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <QuotationDocument v={version} items={items} acceptance={acceptance} companyName={company().name} />
        <div className="stack" style={{ position: "sticky", top: 80 }}>
          {open && (
            <Panel title="Your decision" sub="Please review the full scope before responding.">
              <QuoteResponse versionId={version.id} hash={hash} total={version.total} currency={version.currency} defaultName={actor.name} number={version.number} versionNo={version.version_no} />
            </Panel>
          )}
          {version.status === "accepted" && (
            <Panel title="Accepted">
              <p className="small muted">Thank you! Infinity Web &amp; Apps will confirm the project start and payment schedule. Payments are recorded separately once received.</p>
            </Panel>
          )}
          {version.status === "rejected" && <Panel title="Declined"><p className="small muted">You declined this quotation. Message us any time if you would like to revisit it.</p></Panel>}
          <Panel title="Version history">
            <div className="list">
              {all.map((v) => (
                <Link key={v.id} href={`?v=${v.id}`} className="list-item" aria-current={v.id === version.id ? "true" : undefined}
                  style={v.id === version.id ? { background: "rgba(61,139,255,.08)" } : undefined}>
                  <div className="grow"><div className="small" style={{ fontWeight: 500 }}>{v.number} · v{v.version_no}</div><div className="tiny faint">{fmtDate(v.sent_at ?? v.created_at)}</div></div>
                  <QuoteBadge status={v.status} />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
