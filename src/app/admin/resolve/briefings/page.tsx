import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listBriefings } from "@/server/resolve";
import { adminRecipient } from "@/server/resolve-email";
import { integrations } from "@/lib/config";
import { Badge, DeliveryBadge, Empty, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { resendBriefingAction, sendDailyNowAction } from "@/app/actions/resolve";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Email briefings" };
export const dynamic = "force-dynamic";

export default async function Briefings() {
  const actor = await requireAdmin();
  const [rows, to] = await Promise.all([listBriefings(actor), adminRecipient()]);
  const email = integrations().email;
  return (
    <div className="stack">
      {(!email || !to) && <div className="notice warn">{!email ? "Email (SMTP) is not configured, so briefings are stored here but not emailed. " : ""}{!to ? "No administrator email is set (Settings tab)." : ""}</div>}
      <Panel title="Email briefing history" sub={`Briefings go to ${to || "—"}. Each ticket gets one briefing; urgent alerts and daily summaries are deduplicated too. Failed emails are retried up to 3 times.`}
        actions={<ActionButton action={sendDailyNowAction} className="btn btn-sm" confirm="Send today's daily summary now? (It's only sent once per day.)">Send today's summary now</ActionButton>}>
        {rows.length === 0 ? <Empty icon="send" title="No briefings yet">They appear when clients confirm requests, urgent issues arrive, or the daily summary runs.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Type</th><th>Subject</th><th>To</th><th>Result</th><th></th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id}>
                <td className="small">{fmtDateTime(b.created_at)}</td>
                <td><Badge plain>{b.kind}</Badge></td>
                <td className="small">{b.subject}{b.ticket_id && <div className="tiny"><Link href={`/admin/resolve/${b.ticket_id}`}>{b.ticket_number}</Link></div>}</td>
                <td className="small">{b.recipient}</td>
                <td><DeliveryBadge status={b.status} />{b.error && <div className="tiny faint">{b.error}</div>}<div className="tiny faint">{b.attempts} attempt(s)</div></td>
                <td className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                  <a className="btn btn-sm" href={`/api/admin/resolve/briefings/${b.id}`} target="_blank" rel="noopener">View</a>
                  <ActionButton action={resendBriefingAction.bind(null, b.id)} className="btn btn-sm btn-ghost">Resend</ActionButton></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
