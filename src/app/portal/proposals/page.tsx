import Link from "next/link";
import { requireClient } from "@/lib/session";
import { listClientProposals } from "@/server/proposals";
import { Empty, Money, PageHead, ProposalBadge } from "@/components/ui";
import { fmtDate, PROJECT_TYPE_LABELS } from "@/lib/format";

export const metadata = { title: "Proposals" };
export const dynamic = "force-dynamic";

export default async function ClientProposals() {
  const actor = await requireClient();
  const rows = await listClientProposals(actor);
  return (
    <>
      <PageHead eyebrow="Proposals" title="Your proposals" sub="Review the scope and pricing, ask questions, and accept or decline." />
      <div className="glass panel">
        {rows.length === 0 ? <Empty icon="file" title="No proposals yet">When Infinity Web &amp; Apps sends you a proposal, it will appear here.</Empty> : (
          <div className="list">
            {rows.map((p) => (
              <Link key={p.id} href={`/portal/proposals/${p.id}`} className="list-item" style={{ alignItems: "flex-start" }}>
                <div className="grow stack-sm">
                  <div style={{ fontWeight: 500 }}>{p.title}</div>
                  <span className="tiny faint">{p.number} · v{p.version_no} · {PROJECT_TYPE_LABELS[p.project_type]} · valid until {fmtDate(p.valid_until)}</span>
                </div>
                <div className="stack-sm" style={{ alignItems: "flex-end" }}>
                  <strong className="mono"><Money value={p.total} /></strong>
                  {(Number(p.recurring_monthly) > 0 || Number(p.recurring_annual) > 0) && (
                    <span className="tiny faint">+ {Number(p.recurring_monthly) > 0 && <><Money value={p.recurring_monthly} />/mo </>}{Number(p.recurring_annual) > 0 && <><Money value={p.recurring_annual} />/yr</>}</span>
                  )}
                  <ProposalBadge status={p.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
