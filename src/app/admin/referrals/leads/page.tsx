import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listLeads, listOpenTasks, STAGES } from "@/server/referrals";
import { listAdmins } from "@/server/clients";
import { Badge, Empty, Panel } from "@/components/ui";
import { ActionForm, ActionButton, Submit } from "@/components/forms";
import { createLeadAction, taskStatusAction } from "@/app/actions/referrals";
import { fmtDateTime } from "@/lib/format";
import { fmtCall } from "@/server/booking";
import { stageTone } from "@/components/referrals/charts";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";


export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const [leads, tasks, admins] = await Promise.all([listLeads(actor, { stage: sp.stage, q: sp.q, owner: sp.owner, source: sp.source }), listOpenTasks(actor), listAdmins(actor)]);
  const counts = Object.keys(STAGES).map((k) => [k, leads.filter((l) => l.stage === k).length] as const);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <Link href="?" className="btn btn-sm" aria-current={!sp.stage ? "page" : undefined}>All ({leads.length})</Link>
          {counts.filter(([, n]) => n).map(([k, n]) => <Link key={k} href={`?stage=${k}`} className="btn btn-sm" aria-current={sp.stage === k ? "page" : undefined}>{STAGES[k as keyof typeof STAGES]} ({n})</Link>)}
        </div>
        <Panel>
          <form className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }} role="search">
            {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
            <input name="q" defaultValue={sp.q} className="input" style={{ flex: "1 1 200px" }} placeholder="Search business, contact, email or service" aria-label="Search" />
            <select name="owner" defaultValue={sp.owner ?? ""} className="select" style={{ width: 160 }} aria-label="Owner"><option value="">All owners</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <select name="source" defaultValue={sp.source ?? ""} className="select" style={{ width: 160 }} aria-label="Source"><option value="">All sources</option>
              <option value="client_referral">Client referral</option><option value="manual">Manual</option><option value="direct">Direct</option><option value="other">Other</option></select>
            <button className="btn">Filter</button>
          </form>
          {leads.length === 0 ? <Empty icon="users" title="No leads yet">Referral enquiries and introductions appear here automatically.</Empty> : (
            <div className="table-wrap"><table className="table table-cards">
              <thead><tr><th>Lead</th><th>Stage</th><th>Source / referrer</th><th>Owner</th><th>Next</th></tr></thead>
              <tbody>{leads.map((l) => (
                <tr key={l.id}>
                  <td data-label="Lead"><Link href={`/admin/referrals/leads/${l.id}`} style={{ fontWeight: 500 }}>{l.business_name}</Link>
                    <div className="tiny faint">{l.contact_name ?? "—"} · {l.service ?? "service not set"} · {fmtDateTime(l.created_at)}</div>
                    {l.flags.length > 0 && <div className="row" style={{ gap: 4, marginTop: 2 }}>{l.flags.map((f) => <Badge key={f} tone="amber" plain>{f.replace(/_/g, " ")}</Badge>)}</div>}</td>
                  <td data-label="Stage"><Badge tone={stageTone(l.stage)}>{STAGES[l.stage]}</Badge></td>
                  <td data-label="Source" className="small">{l.source === "client_referral" ? `Referral${l.referrer_name ? ` · ${l.referrer_name}` : ""}` : l.source}</td>
                  <td data-label="Owner" className="small">{l.owner_name ?? "—"}</td>
                  <td data-label="Next" className="small">{l.next_call ? `Call ${fmtCall(l.next_call)}` : l.open_tasks ? `${l.open_tasks} task(s)` : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Follow-up tasks">
          {tasks.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No open tasks.</p> : (
            <div className="stack-sm">{tasks.map((t) => (
              <div key={t.id} className="row" style={{ alignItems: "flex-start" }}>
                <div className="grow small"><Link href={`/admin/referrals/leads/${t.lead_id}`}>{t.business_name}</Link>: {t.description}
                  <div className="tiny faint">{t.assignee_name ?? "Unassigned"}{t.due_at ? ` · due ${fmtDateTime(t.due_at)}` : ""}</div></div>
                <ActionButton action={taskStatusAction.bind(null, t.id, "done")} className="btn btn-sm">Done</ActionButton>
              </div>
            ))}</div>
          )}
        </Panel>
        <Panel title="Add a lead" sub="For leads that didn't come through a referral link.">
          <ActionForm action={createLeadAction} className="stack-sm" toast>
            <input name="business_name" className="input" required minLength={2} placeholder="Business name" aria-label="Business name" />
            <input name="contact_name" className="input" placeholder="Contact name" aria-label="Contact name" />
            <input name="email" type="email" className="input" placeholder="Email" aria-label="Email" />
            <input name="phone" className="input" placeholder="Phone" aria-label="Phone" />
            <select name="source" className="select" defaultValue="manual" aria-label="Source"><option value="manual">Manual</option><option value="direct">Direct</option><option value="other">Other</option></select>
            <Submit className="btn btn-sm">Add lead</Submit>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
