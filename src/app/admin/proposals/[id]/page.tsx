import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getProposal, proposalShareInfo } from "@/server/proposals";
import { getBusiness } from "@/server/pricing";
import { Badge, Money, PageHead, Panel, ProposalBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { ProposalDocument } from "@/components/views/proposal-doc";
import { ProposalComments } from "@/components/views/proposal-comments";
import { markReadyAction, reviseProposalAction, cancelProposalAction } from "@/app/actions/proposals";
import { integrations } from "@/lib/config";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { SendProposal, SharePanel, ConnectProject, DeleteDraft } from "./controls";

export const metadata = { title: "Proposal" };
export const dynamic = "force-dynamic";

const EVENT: Record<string, string> = {
  created: "Proposal created", saved: "Draft saved", ready: "Marked ready to send", sent: "Published to client portal", email: "Email delivery",
  viewed: "Client opened the proposal", comment: "Message", changes_requested: "Client requested changes", accepted: "Client accepted",
  rejected: "Client declined", revised: "Revised version created", cancelled: "Proposal cancelled", project_linked: "Linked to project",
};

export default async function AdminProposal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;
  const { v } = await searchParams;
  let r: Awaited<ReturnType<typeof getProposal>>;
  try { r = await getProposal(actor, id, v); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const [biz, share] = await Promise.all([getBusiness(), proposalShareInfo(actor, id)]);
  const ver = r.version;
  const latest = r.versions[0];
  const a = r.admin!;
  const editable = r.isLatest && ["draft", "ready"].includes(ver.status) && !r.proposal.cancelled_at;
  const accepted = r.versions.find((x) => x.status === "accepted");

  return (
    <>
      <PageHead eyebrow={<Link href="/admin/proposals">Proposals</Link>} title={r.proposal.title}
        sub={<>{r.proposal.number} · {r.client.business_name} · version {ver.version_no} · <ProposalBadge status={ver.status} /></>}
        actions={<>
          <a className="btn" href={`/api/proposals/${id}/pdf?v=${ver.id}`} target="_blank" rel="noopener"><Icon name="download" /> {editable ? "Preview PDF" : "PDF"}</a>
          {editable && <Link className="btn btn-primary" href={`/admin/proposals/${id}/edit`}><Icon name="edit" /> Edit</Link>}
        </>} />
      {!r.isLatest && <div className="notice warn" style={{ marginBottom: 16 }}>Viewing version {ver.version_no}. <Link href={`/admin/proposals/${id}`}>Go to the latest version</Link>.</div>}
      {editable && <div className="notice info" style={{ marginBottom: 16 }}>Preview — this is exactly what the client will see once you send it.</div>}

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <ProposalDocument number={r.proposal.number} title={r.proposal.title} client={r.client} v={ver} items={r.items} acceptance={r.acceptance} biz={biz} />
        <div className="stack">
          <Panel title="Status" actions={<ProposalBadge status={latest.status} />}>
            <dl className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div><dt>One-time total</dt><dd><Money value={latest.total} /></dd></div>
              <div><dt>Recurring</dt><dd className="small"><Money value={latest.recurring_monthly} />/mo · <Money value={latest.recurring_annual} />/yr</dd></div>
              <div><dt>Published</dt><dd className="small">{latest.sent_at ? fmtDateTime(latest.sent_at) : "—"}</dd></div>
              <div><dt>Email</dt><dd className="small">{latest.email_status ? <Badge tone={latest.email_status === "sent" ? "green" : latest.email_status === "failed" ? "red" : "amber"}>{latest.email_status.replace("_", " ")}</Badge> : "—"}</dd></div>
              <div><dt>First viewed</dt><dd className="small">{latest.first_viewed_at ? fmtDateTime(latest.first_viewed_at) : "Not yet"}</dd></div>
              <div><dt>Valid until</dt><dd className="small">{fmtDate(latest.valid_until)}</dd></div>
            </dl>
            {latest.client_response_note && <div className="notice warn" style={{ marginTop: 12 }}><strong>Client note:</strong> <span className="pre">{latest.client_response_note}</span></div>}
            {r.acceptance && <div className="notice success" style={{ marginTop: 12 }}>Accepted by {r.acceptance.signer_name} ({r.acceptance.user_email}) on {fmtDateTime(r.acceptance.accepted_at)}{r.acceptance.ip ? ` from ${r.acceptance.ip}` : ""}.</div>}
            <hr />
            <div className="stack">
              {editable && a.blockers.length > 0 && <div className="notice error stack-sm"><strong className="small">Before sending</strong>{a.blockers.map((b, i) => <span key={i} className="small">• {b}</span>)}</div>}
              {editable && latest.status === "draft" && a.blockers.length === 0 && <ActionButton action={markReadyAction.bind(null, id)} className="btn btn-block">Mark ready to send</ActionButton>}
              {editable && <SendProposal proposalId={id} emailConfigured={integrations().email} contactEmail={latest.content.contact.email} disabled={a.blockers.length > 0} />}
              {r.isLatest && !editable && !r.proposal.cancelled_at && <ActionButton action={reviseProposalAction.bind(null, id)} className="btn btn-block"><Icon name="edit" /> Create revised version</ActionButton>}
              {!r.proposal.cancelled_at && latest.status !== "accepted" && !["draft", "ready"].includes(latest.status) &&
                <ActionButton action={cancelProposalAction.bind(null, id)} className="btn btn-ghost btn-block" confirm="Cancel this proposal? The client will no longer be able to accept it.">Cancel proposal</ActionButton>}
              {r.versions.every((x) => ["draft", "ready"].includes(x.status)) && <DeleteDraft proposalId={id} />}
            </div>
          </Panel>

          {accepted && (
            <Panel title="After acceptance" sub="Nothing is marked paid automatically.">
              {r.proposal.project_id ? (
                <div className="stack-sm">
                  <span className="small">Linked to a project. Confirm commencement and raise invoices from the payment schedule there.</span>
                  <div className="row">
                    <Link className="btn btn-sm" href={`/admin/projects/${r.proposal.project_id}`}>Open project</Link>
                    <Link className="btn btn-sm" href={`/admin/projects/${r.proposal.project_id}/billing`}>Invoices &amp; payments</Link>
                    <Link className="btn btn-sm" href={`/admin/projects/${r.proposal.project_id}/milestones`}>Milestones</Link>
                  </div>
                </div>
              ) : <ConnectProject proposalId={id} projects={a.projects} />}
            </Panel>
          )}

          {(latest.sent_at || editable) && !r.proposal.cancelled_at && (
            <Panel title="Share" sub="Clients open proposals only after signing in to their portal.">
              <SharePanel link={share.link} text={share.text} whatsapp={share.whatsapp} portalUsers={share.portalUsers} pendingInvite={share.pendingInvite}
                clientId={r.proposal.client_id} clientEmail={r.client.email} sent={!!latest.sent_at} />
            </Panel>
          )}

          <Panel title="Questions & comments"><ProposalComments proposalId={id} comments={r.comments} meRole="admin" /></Panel>

          {a.internal?.internal_notes && <Panel title={<><Icon name="shield" /> Internal notes</>} sub="Never shown to the client."><p className="small pre">{a.internal.internal_notes}</p></Panel>}

          <Panel title="Versions">
            <div className="list">{r.versions.map((x) => (
              <Link key={x.id} href={`/admin/proposals/${id}?v=${x.id}`} className="list-item" style={x.id === ver.id ? { background: "rgba(61,139,255,.08)" } : undefined}>
                <div className="grow small">Version {x.version_no} · <Money value={x.total} /><div className="tiny faint">{fmtDate(x.sent_at ?? x.created_at)}</div></div>
                <ProposalBadge status={x.status} />
              </Link>
            ))}</div>
          </Panel>

          <Panel title="Activity">
            <div className="list">{a.events.slice(0, 30).map((e) => (
              <div key={e.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <div className="grow small">{EVENT[e.type] ?? e.type}{e.type === "email" ? `: ${String(e.data.status).replace("_", " ")}${e.data.error ? ` (${e.data.error})` : ""}` : ""}
                  <div className="tiny faint">{e.actor_name ?? "System"} · {fmtDateTime(e.created_at)}</div></div>
              </div>
            ))}</div>
          </Panel>
        </div>
      </div>
    </>
  );
}
