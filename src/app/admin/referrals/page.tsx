import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { referralAnalytics, METRIC_DEFINITIONS, type AnalyticsFilter } from "@/server/referral-analytics";
import { STAGES } from "@/server/referrals";
import { ENQUIRY_SERVICES } from "@/server/referral-public";
import { listClients, listAdmins } from "@/server/clients";
import { Panel } from "@/components/ui";
import { BarList, Columns } from "@/components/referrals/charts";
import { formatMoney } from "@/lib/money";
import { istToday, addDays } from "@/lib/dates";
import { Insights } from "./insights";

export const metadata = { title: "Referral intelligence" };
export const dynamic = "force-dynamic";
const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

export default async function ReferralIntelligence({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const f: AnalyticsFilter = { from: ok(sp.from) ?? addDays(istToday(), -89), to: ok(sp.to) ?? istToday(), referrer: sp.referrer || undefined,
    category: sp.category || undefined, service: sp.service || undefined, owner: sp.owner || undefined, stage: sp.stage || undefined };
  const [a, clients, admins] = await Promise.all([referralAnalytics(actor, f), listClients(actor), listAdmins(actor)]);
  const c = a.counts;
  const tiles: [string, string, string][] = [
    ["Referral invitations", String(c.invitations), "invitations"], ["Invitation acceptance", `${a.rates.acceptance}%`, "acceptance"], ["Link visits", String(c.visits), "visits"],
    ["Verified referral enquiries", String(c.verified), "verified"], ["Qualified leads", String(c.qualified), "qualified"], ["Calls booked", String(c.booked), "booked"],
    ["Calls completed", String(c.completed), "completed"], ["Proposals sent", String(c.proposals), "proposals"], ["Proposals accepted", String(c.accepted), "accepted"],
    ["Converted clients", String(c.converted), "converted"], ["Referral revenue", formatMoney(c.revenue), "revenue"], ["Conversion rate", `${a.rates.conversion_rate}%`, "conversion_rate"],
    ["Qualification rate", `${a.rates.qualification_rate}%`, "qualification_rate"], ["Call booking rate", `${a.rates.booking_rate}%`, "booking_rate"],
    ["Avg. time to conversion", c.converted ? `${a.avgDaysToConversion} days` : "—", "time_to_conversion"],
  ];
  return (
    <div className="stack">
      <form className="row" style={{ flexWrap: "wrap", gap: 8 }} aria-label="Filters">
        <label className="small row" style={{ gap: 6 }}>From <input type="date" name="from" defaultValue={f.from} className="input" style={{ width: 150 }} /></label>
        <label className="small row" style={{ gap: 6 }}>To <input type="date" name="to" defaultValue={f.to} className="input" style={{ width: 150 }} /></label>
        <select name="referrer" defaultValue={f.referrer ?? ""} className="select" style={{ width: 180 }} aria-label="Referring client"><option value="">All referrers</option>
          {clients.map((x) => <option key={x.id} value={x.id}>{x.business_name}</option>)}</select>
        <select name="service" defaultValue={f.service ?? ""} className="select" style={{ width: 170 }} aria-label="Service"><option value="">All services</option>
          {ENQUIRY_SERVICES.map((s) => <option key={s}>{s}</option>)}</select>
        <input name="category" defaultValue={f.category ?? ""} className="input" style={{ width: 150 }} placeholder="Business category" aria-label="Business category" />
        <select name="owner" defaultValue={f.owner ?? ""} className="select" style={{ width: 150 }} aria-label="Salesperson"><option value="">All owners</option>
          {admins.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select name="stage" defaultValue={f.stage ?? ""} className="select" style={{ width: 170 }} aria-label="Stage"><option value="">All stages</option>
          {Object.entries(STAGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn">Apply</button><Link className="btn btn-ghost" href="/admin/referrals">Reset</Link>
      </form>
      <div className="grid grid-4">
        {tiles.map(([l, v, k]) => <div key={l} className="panel" title={METRIC_DEFINITIONS[k]}><span className="tiny faint">{l}</span><div className="stat-value">{v}</div></div>)}
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Panel title="Conversion funnel" sub="Verified referral leads created in the period; each lead counts once per step.">
          <BarList title="Leads" rows={[{ label: "Link visits", value: c.visits }, { label: "Verified enquiries", value: c.verified }, { label: "Qualified", value: c.qualified },
            { label: "Calls booked", value: c.booked }, { label: "Calls completed", value: c.completed }, { label: "Proposals sent", value: c.proposals },
            { label: "Proposals accepted", value: c.accepted }, { label: "Converted", value: c.converted }]} />
        </Panel>
        <Panel title="Monthly referral acquisition">
          <Columns title="Referral leads" series={["Verified leads", "Converted"]} data={a.monthly.map((m) => ({ label: m.month, values: [m.verified, m.converted] }))} />
        </Panel>
        <Panel title="Referral revenue by month" sub="Confirmed payments minus refunds from converted referral clients.">
          <Columns title="Revenue" series={["Revenue"]} money data={a.revenueTrend.map((m) => ({ label: m.month, values: [Math.max(0, m.revenue)] }))} />
        </Panel>
        <Panel title="Lead sources" sub="All leads in the period, by source.">
          <BarList title="Leads" rows={a.sources.map((s) => ({ label: s.source.replace(/_/g, " "), value: s.leads, hint: `${s.converted} converted` }))} />
        </Panel>
        <Panel title="Pipeline by stage">
          <BarList title="Leads" rows={Object.entries(STAGES).map(([k, l]) => ({ label: l, value: a.stages.find((s) => s.stage === k)?.n ?? 0 }))} />
        </Panel>
        <Panel title="Time to conversion">
          <BarList title="Converted leads" rows={a.timeToConversion.map((t) => ({ label: t.bucket, value: t.n }))} emptyText="No conversions in this period yet." />
        </Panel>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Panel title="Top referring clients">
          {a.byReferrer.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No referrals in this period.</p> : (
            <table className="table"><thead><tr><th>Client</th><th className="num">Verified</th><th className="num">Converted</th><th className="num">Revenue</th></tr></thead>
              <tbody>{a.byReferrer.map((r) => <tr key={r.client_id}><td><Link href={`/admin/clients/${r.client_id}`}>{r.business_name}</Link></td><td className="num">{r.verified}</td><td className="num">{r.converted}</td><td className="num">{formatMoney(r.revenue)}</td></tr>)}</tbody></table>
          )}
        </Panel>
        <Panel title="By service">
          {a.byService.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No referrals in this period.</p> : (
            <table className="table"><thead><tr><th>Service</th><th className="num">Verified</th><th className="num">Converted</th><th className="num">Rate</th></tr></thead>
              <tbody>{a.byService.map((r) => <tr key={r.service}><td>{r.service}</td><td className="num">{r.verified}</td><td className="num">{r.converted}</td><td className="num">{r.verified ? Math.round((r.converted / r.verified) * 1000) / 10 : 0}%</td></tr>)}</tbody></table>
          )}
        </Panel>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Panel title="AI insights (optional)"><Insights filter={f} /></Panel>
        <Panel title="How each metric is calculated">
          <dl className="stack-sm small" style={{ margin: 0 }}>{Object.entries(METRIC_DEFINITIONS).map(([k, v]) => <div key={k}><dt style={{ fontWeight: 500 }}>{k.replace(/_/g, " ")}</dt><dd className="muted" style={{ margin: 0 }}>{v}</dd></div>)}</dl>
        </Panel>
      </div>
    </div>
  );
}
