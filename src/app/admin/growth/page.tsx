import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { growthDashboard, DEFINITIONS } from "@/server/growth";
import { listRewards } from "@/server/rewards";
import { Badge, Empty, Money, PageHead, Panel } from "@/components/ui";
import { Columns } from "@/components/referrals/charts";
import { Icon } from "@/components/icons";

export const metadata = { title: "Revenue & growth" };
export const dynamic = "force-dynamic";

const RANGES = [[30, "30 days"], [90, "90 days"], [180, "6 months"], [365, "12 months"]] as const;
const SOURCE: Record<string, [string, "violet" | "blue" | "green" | ""]> = {
  client_referral: ["Referral", "violet"], upgrade_request: ["Upgrade", "blue"], ai_advisor: ["AI advisor", "green"], direct: ["Direct", ""], manual: ["Manual", ""], other: ["Other", ""],
};

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const actor = await requireAdmin();
  const d = Number((await searchParams).d) || 90;
  const [g, rewards] = await Promise.all([growthDashboard(actor, d), listRewards(actor, "eligible")]);
  const k = g.kpis;
  const tiles: [string, React.ReactNode, string, string?][] = [
    ["Active clients", k.activeClients, "activeClients"],
    ["Active projects", k.activeProjects, "activeProjects"],
    ["Pending approvals", k.pendingApprovals, "pendingApprovals"],
    ["Outstanding invoices", <Money key="o" value={k.outstanding} />, "outstanding", `${k.outstandingCount} invoices`],
    ["Upgrade requests", k.upgradeRequests, "upgradeRequests"],
    ["Referral submissions", k.referralSubmissions, "referralSubmissions"],
    ["Qualified leads", k.qualifiedLeads, "qualifiedLeads"],
    ["Conversion rate", k.conversionRate == null ? "—" : `${k.conversionRate}%`, "conversionRate", `${k.leadsWon} of ${k.leadsCreated} leads`],
    ["Revenue from upgrades", <Money key="u" value={k.upgradeRevenue} />, "upgradeRevenue"],
    ["Revenue from referrals", <Money key="r" value={k.referralRevenue} />, "referralRevenue"],
    ["Renewals in 30 days", k.renewals, "renewals"],
  ];
  return (
    <>
      <PageHead eyebrow="Growth" title="Revenue & growth" sub={`From ${g.range.from} to ${g.range.to} (IST). Money counts confirmed payments net of refunds.`}
        actions={<nav className="seg" aria-label="Time range">{RANGES.map(([n, l]) => <Link key={n} href={`/admin/growth?d=${n}`} className="btn btn-sm btn-ghost" aria-current={d === n ? "page" : undefined} style={d === n ? { color: "var(--blue-2)" } : undefined}>{l}</Link>)}</nav>} />

      <section aria-label="Key numbers" className="grid stagger" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", marginBottom: 18 }}>
        {tiles.map(([label, value, key, extra]) => (
          <div key={key} className="glass panel" style={{ padding: 16 }} title={DEFINITIONS[key]}>
            <span className="tiny faint">{label}</span>
            <div className="stat-value">{value}</div>
            {extra && <span className="tiny faint">{extra}</span>}
          </div>
        ))}
      </section>

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <Panel title="Growth revenue by month" sub="Confirmed payments, net of refunds, last 6 months">
          <Columns title="Growth revenue by month" money series={["Upgrades", "Referrals"]} data={g.months.map((m) => ({ label: m.month.slice(5) + "/" + m.month.slice(2, 4), values: [m.upgrades, m.referrals] }))} />
        </Panel>
        <div className="stack">
          <Panel id="rewards" title="Rewards to approve" actions={<Link href="/admin/referrals/rewards" className="btn btn-sm btn-ghost">All rewards</Link>}>
            {rewards.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing waiting.</p> : (
              <div className="list">{rewards.slice(0, 5).map((w) => (
                <Link key={w.id} href="/admin/referrals/rewards" className="list-item"><div className="grow"><div className="small" style={{ fontWeight: 500 }}>{w.reward_text} · {w.referrer}</div>
                  <div className="tiny faint">Referred {w.referred}</div></div>{w.duplicate ? <Badge tone="red" plain>Check duplicate</Badge> : <Badge tone="amber" plain>Review</Badge>}</Link>
              ))}</div>
            )}
          </Panel>
          <Panel title="Automation health" sub="Last 7 days" actions={<Link href="/admin/referrals/automation" className="btn btn-sm btn-ghost">Log</Link>}>
            <dl className="kv">
              <div><dt>Events processed</dt><dd>{g.health.processed}</dd></div>
              <div><dt>Emails sent</dt><dd>{g.health.sentEmails}</dd></div>
              <div><dt>Failed events</dt><dd style={{ color: g.health.failedEvents ? "var(--red)" : undefined }}>{g.health.failedEvents}</dd></div>
              <div><dt>Failed emails</dt><dd style={{ color: g.health.failedEmails ? "var(--red)" : undefined }}>{g.health.failedEmails}</dd></div>
            </dl>
          </Panel>
        </div>
      </div>

      <Panel title="Sales pipeline" className="section" sub="Every referral, upgrade request and advisor enquiry is an opportunity. Open one to assign it, change its stage, add notes or schedule a follow-up."
        actions={<Link href="/admin/referrals/leads" className="btn btn-sm"><Icon name="plus" /> Add or manage leads</Link>}>
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6 }}>
          {g.pipeline.map((p) => (
            <div key={p.key} style={{ minWidth: 220, flex: 1 }} className="stack-sm">
              <div className="row-between small"><strong>{p.label}</strong><span className="faint">{p.leads.length}</span></div>
              {p.leads.length === 0 ? <div className="tiny faint" style={{ padding: 10, border: "1px dashed var(--border)", borderRadius: 10 }}>Empty</div> :
                p.leads.slice(0, 8).map((l) => (
                  <Link key={l.id} href={`/admin/referrals/leads/${l.id}`} className="glass" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, color: "var(--text)", borderRadius: 12 }}>
                    <strong className="small">{l.business_name}</strong>
                    {l.service && <span className="tiny muted">{l.service}</span>}
                    <span className="row-between"><Badge tone={SOURCE[l.source]?.[1] ?? ""} plain>{SOURCE[l.source]?.[0] ?? l.source}</Badge><span className="tiny faint">{l.owner_name ?? "Unassigned"}</span></span>
                    {l.next_task && <span className="tiny faint">Next: {l.next_task}</span>}
                  </Link>
                ))}
              {p.leads.length > 8 && <Link href="/admin/referrals/leads" className="tiny">+{p.leads.length - 8} more</Link>}
            </div>
          ))}
        </div>
      </Panel>

      <details className="glass panel section">
        <summary className="small"><strong>How each number is calculated</strong></summary>
        <dl className="stack-sm" style={{ marginTop: 12 }}>{Object.entries(DEFINITIONS).map(([key, v]) => <div key={key} className="small"><dt className="faint" style={{ display: "inline" }}>{tiles.find((t) => t[2] === key)?.[0]}: </dt><dd style={{ display: "inline", margin: 0 }}>{v}</dd></div>)}</dl>
      </details>
      {g.pipeline.every((p) => p.leads.length === 0) && <div className="glass panel section"><Empty icon="trend" title="No opportunities yet">Upgrade requests, referrals and advisor enquiries will appear in the pipeline automatically.</Empty></div>}
    </>
  );
}
