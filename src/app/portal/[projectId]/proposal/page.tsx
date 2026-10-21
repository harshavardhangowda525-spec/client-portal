import Link from "next/link";
import { redirect } from "next/navigation";
import { requireClient } from "@/lib/session";
import { listProjectProposals, unlinkedClientProposals } from "@/server/proposals";
import { Empty, Money, PageHead, Panel, ProposalBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Proposal" };

export default async function ClientProjectProposal({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const linked = (await listProjectProposals(actor, projectId)).filter((p) => p.versions.length > 0);
  const pending = (await unlinkedClientProposals(actor, actor.clientId!)).filter((p) => ["sent", "viewed", "changes_requested"].includes(p.status));
  const all = [...linked.map((p) => ({ id: p.id, number: p.number, title: p.title, status: p.versions[0].status, total: Number(p.versions[0].total), valid_until: p.versions[0].valid_until })),
    ...pending.map((p) => ({ id: p.id, number: p.number, title: p.title, status: p.status, total: Number(p.total), valid_until: p.valid_until }))];
  if (all.length === 1) redirect(`/portal/proposals/${all[0].id}`);
  return (
    <>
      <PageHead eyebrow="Proposal" title="Your proposal" sub="The scope, price and payment schedule for this project." />
      <Panel>
        {all.length === 0 ? <Empty icon="file" title="No proposal yet">Your proposal will appear here as soon as it is ready for you to review.</Empty> : (
          <div className="list">{all.map((p) => (
            <Link key={p.id} href={`/portal/proposals/${p.id}`} className="list-item">
              <div className="grow"><strong style={{ fontWeight: 500 }}>{p.number} · {p.title}</strong><div className="tiny faint">Valid until {fmtDate(p.valid_until)}</div></div>
              <Money value={p.total} /> <ProposalBadge status={p.status} />
            </Link>
          ))}</div>
        )}
      </Panel>
    </>
  );
}
