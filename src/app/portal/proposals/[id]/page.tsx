import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/session";
import { getProposal, recordProposalView } from "@/server/proposals";
import { getBusiness } from "@/server/pricing";
import { PageHead, Panel, ProposalBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ProposalDocument } from "@/components/views/proposal-doc";
import { ProposalComments } from "@/components/views/proposal-comments";
import { ProposalResponse } from "./response";
import { AppError } from "@/lib/errors";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Proposal" };
export const dynamic = "force-dynamic";

export default async function ClientProposal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  const { v } = await searchParams;
  let r: Awaited<ReturnType<typeof getProposal>>;
  try { r = await getProposal(actor, id, v); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  await recordProposalView(actor, r.version.id);
  const biz = await getBusiness();
  const ver = r.version;
  const open = r.isLatest && ["sent", "viewed", "changes_requested"].includes(ver.status) && !r.proposal.cancelled_at;
  const accepted = r.versions.find((x) => x.status === "accepted");

  return (
    <>
      <PageHead eyebrow={<Link href="/portal/proposals">Proposals</Link>} title={r.proposal.title}
        sub={<>{r.proposal.number} · version {ver.version_no} · valid until {fmtDate(ver.valid_until)} · <ProposalBadge status={ver.status} /></>}
        actions={<a className="btn" href={`/api/proposals/${id}/pdf?v=${ver.id}`} target="_blank" rel="noopener"><Icon name="download" /> Download PDF</a>} />
      {!r.isLatest && <div className="notice warn" style={{ marginBottom: 16 }}>You are viewing an older version. <Link href={`/portal/proposals/${id}`}>View the latest version</Link>.</div>}
      {r.proposal.cancelled_at && <div className="notice error" style={{ marginBottom: 16 }}>This proposal has been withdrawn by Infinity Web &amp; Apps.</div>}
      {ver.status === "expired" && <div className="notice error" style={{ marginBottom: 16 }}>This proposal expired on {fmtDate(ver.valid_until)}. Ask us below for an updated proposal.</div>}
      {ver.status === "changes_requested" && <div className="notice info" style={{ marginBottom: 16 }}>You requested changes. We will send a revised version — you can still accept this one if you prefer.</div>}
      {accepted && accepted.id !== ver.id && <div className="notice success" style={{ marginBottom: 16 }}>You accepted version {accepted.version_no}. <Link href={`?v=${accepted.id}`}>View the accepted version</Link>.</div>}
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <ProposalDocument number={r.proposal.number} title={r.proposal.title} client={r.client} v={ver} items={r.items} acceptance={r.acceptance} biz={biz} />
        <div className="stack" style={{ position: "sticky", top: 80 }}>
          {open && (
            <Panel title="Your decision" sub="Please read the full proposal before responding.">
              <ProposalResponse versionId={ver.id} hash={r.hash} number={r.proposal.number} versionNo={ver.version_no} defaultName={actor.name}
                total={Number(ver.total)} monthly={Number(ver.recurring_monthly)} annual={Number(ver.recurring_annual)}
                milestones={ver.milestones.map((m) => ({ label: m.label, due: m.due, amount: Number(m.amount) }))} tbc={ver.has_tbc_items} />
            </Panel>
          )}
          {ver.status === "accepted" && (
            <Panel title="Accepted">
              <p className="small muted">Thank you! We will confirm the project start and payment schedule. Acceptance does not take any payment — invoices are issued separately.</p>
            </Panel>
          )}
          <Panel title="Questions & comments"><ProposalComments proposalId={id} comments={r.comments} meRole="client" /></Panel>
          {r.versions.length > 1 && (
            <Panel title="Versions">
              <div className="list">{r.versions.map((x) => (
                <Link key={x.id} href={`?v=${x.id}`} className="list-item" style={x.id === ver.id ? { background: "rgba(61,139,255,.08)" } : undefined}>
                  <div className="grow small">Version {x.version_no}<div className="tiny faint">{fmtDate(x.sent_at ?? x.created_at)}</div></div>
                  <ProposalBadge status={x.status} />
                </Link>
              ))}</div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
