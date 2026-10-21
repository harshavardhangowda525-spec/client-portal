import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listProjectProposals, unlinkedClientProposals } from "@/server/proposals";
import { getProjectSummary } from "@/server/clients";
import { getBilling } from "@/server/billing";
import { Empty, Money, Panel, ProposalBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { connectProjectAction } from "@/app/actions/proposals";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectProposal({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const project = await getProjectSummary(actor, projectId);
  const [linked, unlinked, billing] = await Promise.all([listProjectProposals(actor, projectId), unlinkedClientProposals(actor, project.client_id), getBilling(actor, projectId)]);
  const newHref = `/admin/proposals/new?project=${projectId}`;
  return (
    <div className="stack">
      <div className="grid grid-3">
        <Panel><span className="tiny faint">Project total (accepted proposal)</span><div className="stat-value"><Money value={billing.contractTotal} /></div>
          <span className="tiny faint">{billing.proposal ? `${billing.proposal.number} v${billing.proposal.version_no}` : "No accepted proposal yet"}</span></Panel>
        <Panel><span className="tiny faint">Received</span><div className="stat-value" style={{ color: "#6ee7b7" }}><Money value={billing.paidTotal} /></div><span className="tiny faint">Confirmed payments</span></Panel>
        <Panel><span className="tiny faint">Remaining</span><div className="stat-value"><Money value={billing.remaining} /></div>
          <span className="tiny faint"><Link href={`/admin/projects/${projectId}/billing`}>Invoices &amp; payments →</Link></span></Panel>
      </div>

      <Panel title="Proposals for this project" actions={<Link className="btn btn-primary btn-sm" href={newHref}><Icon name="plus" /> Create proposal for this project</Link>}>
        {linked.length === 0 ? (
          <Empty icon="file" title="No proposal yet" action={<Link className="btn btn-primary" href={newHref}>Create proposal</Link>}>
            Create a proposal for this project. When the client accepts it, its total and payment milestones become the project&apos;s billing.
          </Empty>
        ) : (
          <div className="list">{linked.map((p) => {
            const v = p.versions[0];
            return (
              <Link key={p.id} href={`/admin/proposals/${p.id}`} className="list-item">
                <div className="grow"><strong style={{ fontWeight: 500 }}>{p.number} · {p.title}</strong>
                  <div className="tiny faint">Version {v.version_no} · valid until {fmtDate(v.valid_until)}{v.accepted_at ? ` · accepted ${fmtDate(v.accepted_at)}` : ""}</div></div>
                <Money value={Number(v.total)} /> <ProposalBadge status={v.status} />
              </Link>
            );
          })}</div>
        )}
      </Panel>

      {unlinked.length > 0 && (
        <Panel title="Other proposals for this client" sub="Not linked to any project yet. Link one if it belongs to this project.">
          <div className="list">{unlinked.map((p) => (
            <div key={p.id} className="list-item">
              <div className="grow"><Link href={`/admin/proposals/${p.id}`} style={{ fontWeight: 500 }}>{p.number} · {p.title}</Link>
                <div className="tiny faint">Version {p.version_no} · valid until {fmtDate(p.valid_until)}</div></div>
              <Money value={Number(p.total)} /> <ProposalBadge status={p.status} />
              {p.status === "accepted" && (
                <ActionButton action={connectProjectAction.bind(null, p.id)} fields={{ project_id: projectId }} className="btn btn-sm" confirm={`Link ${p.number} to this project? It becomes the project's price and payment schedule.`}>
                  Link to this project</ActionButton>
              )}
            </div>
          ))}</div>
          <p className="tiny faint" style={{ marginTop: 8 }}>Proposals that aren&apos;t accepted yet link automatically if you create them from this project.</p>
        </Panel>
      )}
    </div>
  );
}
