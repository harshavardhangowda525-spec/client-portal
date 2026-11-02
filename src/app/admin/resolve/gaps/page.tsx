import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listGaps } from "@/server/resolve";
import { GAP_LABELS, type GapKind } from "@/server/resolve-gaps";
import { Badge, Empty, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { closeGapAction } from "@/app/actions/resolve";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Communication gaps" };
export const dynamic = "force-dynamic";

export default async function Gaps({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireAdmin();
  const status = (await searchParams).status ?? "open";
  const gaps = await listGaps(actor, status);
  return (
    <Panel sub="Detected daily and whenever a client confirms a request. Gaps only flag and recommend: nothing changes scope, deadlines or proposals automatically."
      actions={<div className="row"><Link className="btn btn-sm" href="?">Open</Link><Link className="btn btn-sm" href="?status=resolved">Resolved</Link><Link className="btn btn-sm" href="?status=all">All</Link></div>}>
      {gaps.length === 0 ? <Empty icon="check" title="No gaps">No communication problems detected.</Empty> : (
        <div className="list">{gaps.map((g) => (
          <div key={g.id} className="list-item" style={{ alignItems: "flex-start" }}>
            <div className="grow stack-sm">
              <div className="row" style={{ flexWrap: "wrap" }}><Badge tone={g.severity === "critical" || g.severity === "high" ? "red" : g.severity === "low" ? "" : "amber"} plain>{GAP_LABELS[g.kind as GapKind] ?? g.kind}</Badge>
                <span className="small">{g.business_name} · {g.project_name}</span>{g.ticket_id && <Link className="small" href={`/admin/resolve/${g.ticket_id}`}>{g.ticket_number}</Link>}</div>
              <span className="small">{g.description}</span>
              {g.missing && <span className="tiny faint">Missing: {g.missing}</span>}
              {g.recommendation && <span className="tiny">→ {g.recommendation}</span>}
              <span className="tiny faint">Detected {fmtDateTime(g.detected_at)}{g.resolved_at ? ` · ${g.status} ${fmtDateTime(g.resolved_at)}${g.resolution ? ` (${g.resolution})` : ""}` : ""}</span>
            </div>
            {g.status === "open" && <div className="row"><ActionButton action={closeGapAction.bind(null, g.id)} fields={{ status: "resolved" }} className="btn btn-sm">Resolved</ActionButton>
              <ActionButton action={closeGapAction.bind(null, g.id)} fields={{ status: "dismissed" }} className="btn btn-sm btn-ghost">Dismiss</ActionButton></div>}
          </div>
        ))}</div>
      )}
    </Panel>
  );
}
