import { Badge, Money, ProposalBadge } from "../ui";
import { fmtDate, fmtDateTime, PROJECT_TYPE_LABELS, periodLabel } from "@/lib/format";
import type { ProposalItem, ProposalVersion } from "@/server/proposals";

type Biz = { name: string; tagline: string; email: string; phone: string; address: string; hasLogo: boolean };

const List = ({ items }: { items?: string[] }) => (items?.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);
const Para = ({ title, text }: { title: string; text?: string | null }) => (text ? <><h3>{title}</h3><p className="muted pre">{text}</p></> : null);

export function ProposalDocument({ number, title, client, v, items, acceptance, biz }: {
  number: string; title: string; client: { business_name: string };
  v: ProposalVersion; items: ProposalItem[]; biz: Biz;
  acceptance: { signer_name: string; accepted_at: Date; content_hash: string; user_email: string } | null;
}) {
  const c = v.content;
  const cur = v.currency;
  const base = items.filter((i) => i.section === "base");
  const incl = items.filter((i) => i.section === "inclusion");
  const addons = items.filter((i) => i.section === "addon");
  const custom = items.filter((i) => i.section === "custom");
  const ext = items.filter((i) => i.section === "external");
  const maint = items.find((i) => i.section === "maintenance");
  const recurring = items.filter((i) => i.billing === "recurring" && i.charged);
  const sd = c.scope_details ?? { platforms: [] };
  const md = (maint?.details ?? {}) as Record<string, string | null>;

  return (
    <article className="glass doc" aria-label={`Proposal ${number}`}>
      <header className="doc-head">
        <div className="row" style={{ gap: 14, alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {biz.hasLogo && <img src="/api/brand/logo" alt="" style={{ height: 44, width: "auto", borderRadius: 8 }} />}
          <div className="stack-sm">
            <span className="eyebrow" style={{ margin: 0 }}>{biz.name} · {biz.tagline}</span>
            <h2 style={{ fontSize: "1.35rem" }}>{title}</h2>
            <span className="small muted">Proposal {number} · Version {v.version_no} · {PROJECT_TYPE_LABELS[c.project_type] ?? c.project_type}</span>
          </div>
        </div>
        <div className="stack-sm" style={{ alignItems: "flex-end" }}>
          <ProposalBadge status={v.status} />
          <span className="small muted">Prepared {fmtDate(v.created_at)}</span>
          <span className="small muted">Valid until {fmtDate(v.valid_until)}</span>
        </div>
      </header>

      <div className="grid grid-2">
        <div className="stack-sm">
          <span className="tiny faint">Prepared for</span>
          <strong style={{ fontWeight: 500 }}>{c.contact.name}</strong>
          <span className="small muted">{client.business_name}</span>
          <span className="small muted">{[c.contact.email, c.contact.phone].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="stack-sm">
          <span className="tiny faint">Prepared by</span>
          <strong style={{ fontWeight: 500 }}>{biz.name}</strong>
          <span className="small muted">{[biz.email, biz.phone].filter(Boolean).join(" · ")}</span>
          {c.target_launch_date && <span className="small muted">Target launch: {fmtDate(c.target_launch_date)} (estimate)</span>}
        </div>
      </div>

      <Para title="Executive summary" text={c.executive_summary} />
      <Para title="Your requirements" text={c.requirements} />
      <Para title="Recommended solution" text={c.recommended_solution} />
      <Para title="Project description" text={c.description} />
      {(sd.platforms?.length || sd.pages || sd.screens || sd.integrations || sd.roles || sd.backend) ? (
        <>
          <h3>Technical scope</h3>
          <dl className="kv">
            {!!sd.platforms?.length && <div><dt>Platforms</dt><dd>{sd.platforms.map((p) => (p === "ios" ? "iOS" : p[0].toUpperCase() + p.slice(1))).join(", ")}</dd></div>}
            {sd.pages ? <div><dt>Pages</dt><dd>{sd.pages}</dd></div> : null}
            {sd.screens ? <div><dt>Screens</dt><dd>{sd.screens}</dd></div> : null}
            {sd.integrations ? <div><dt>Integrations</dt><dd>{sd.integrations}</dd></div> : null}
            {sd.roles ? <div><dt>User roles</dt><dd>{sd.roles}</dd></div> : null}
            {sd.backend && <div><dt>Backend</dt><dd style={{ textTransform: "capitalize" }}>{sd.backend}</dd></div>}
            {sd.authentication && <div><dt>Authentication</dt><dd>{sd.authentication}</dd></div>}
            {sd.storage && <div><dt>Storage</dt><dd>{sd.storage}</dd></div>}
          </dl>
        </>
      ) : null}
      <Para title="Objectives" text={c.scope.objectives} />
      <div className="grid grid-2">
        {!!c.scope.features.length && <div><h3>Features included</h3><List items={c.scope.features} /></div>}
        {!!c.scope.pages_screens.length && <div><h3>Pages / screens</h3><List items={c.scope.pages_screens} /></div>}
      </div>
      <Para title="Design and functionality" text={c.scope.design_requirements} />
      {!!c.scope.deliverables.length && <><h3>Deliverables</h3><List items={c.scope.deliverables} /></>}

      <h3>Price breakdown · development <Badge plain>One-time</Badge></h3>
      <div className="table-wrap">
        <table className="table table-cards">
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {base.map((b) => (
              <tr key={b.id}><td data-label=""><div style={{ fontWeight: 600, textAlign: "left" }}>{b.name}</div><div className="tiny faint" style={{ textAlign: "left" }}>Base package</div></td>
                <td data-label="Qty" className="num">1</td><td data-label="Unit price" className="num"><Money value={b.unit_price} currency={cur} /></td><td data-label="Amount" className="num"><Money value={b.amount} currency={cur} /></td></tr>
            ))}
            {incl.length > 0 && (
              <tr className="incl-row">
                <td colSpan={4} data-label="">
                  <div className="tiny faint" style={{ textAlign: "left", marginBottom: 6 }}>Included in the package — not charged separately</div>
                  <ul className="incl-list">
                    {incl.map((i) => (
                      <li key={i.id}><span>{i.name}</span><span className="mono faint"><Money value={i.amount} currency={cur} /></span></li>
                    ))}
                  </ul>
                </td>
              </tr>
            )}
            {[...addons, ...custom].map((i) => (
              <tr key={i.id}>
                <td data-label=""><div style={{ fontWeight: 500, textAlign: "left" }}>{i.name}</div>
                  <div className="tiny faint" style={{ textAlign: "left" }}>{i.section === "addon" ? "Optional add-on" : "Custom development"}{i.description ? ` · ${i.description}` : ""}</div></td>
                <td data-label="Qty" className="num">{Number(i.quantity)}</td>
                <td data-label="Unit price" className="num">{i.unit_price == null ? "To be confirmed" : <Money value={i.unit_price} currency={cur} />}</td>
                <td data-label="Amount" className="num">{i.amount == null ? "To be confirmed" : <Money value={i.amount} currency={cur} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ext.length > 0 && (
        <>
          <h3>Domain, hosting &amp; third-party costs</h3>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead><tr><th>Service</th><th>Billing</th><th>Paid by</th><th className="num">Amount</th></tr></thead>
              <tbody>{ext.map((i) => (
                <tr key={i.id}>
                  <td data-label=""><div style={{ fontWeight: 500, textAlign: "left" }}>{i.name}</div>{i.renewal_date && <div className="tiny faint" style={{ textAlign: "left" }}>Renews {fmtDate(i.renewal_date)}</div>}</td>
                  <td data-label="Billing"><Badge plain tone={i.billing === "one_time" ? "" : "violet"}>{periodLabel(i.billing, i.period)}</Badge></td>
                  <td data-label="Paid by" className="small muted">{i.included_in_package ? "Included" : i.payer === "client" ? "You, directly to the provider" : "Billed by us"}</td>
                  <td data-label="Amount" className="num">{i.amount == null ? <Badge tone="amber" plain>To be confirmed</Badge> : <Money value={i.amount} currency={cur} />}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 6 }}>Provider fees are set by the providers and may change. Items marked “To be confirmed” are not included in the totals.</p>
        </>
      )}

      <h3>Pricing summary</h3>
      <div className="totals" style={{ width: "min(420px, 100%)" }}>
        {Number(v.base_amount) > 0 && <div className="row-between"><span>Base package</span><Money value={v.base_amount} currency={cur} /></div>}
        {Number(v.addons_amount) > 0 && <div className="row-between"><span>Additional features</span><Money value={v.addons_amount} currency={cur} /></div>}
        {Number(v.custom_amount) > 0 && <div className="row-between"><span>Custom development</span><Money value={v.custom_amount} currency={cur} /></div>}
        {Number(v.external_amount) > 0 && <div className="row-between"><span>External services (one-time)</span><Money value={v.external_amount} currency={cur} /></div>}
        <div className="row-between"><span>One-time subtotal</span><Money value={v.subtotal} currency={cur} /></div>
        {Number(v.discount_amount) > 0 && <div className="row-between" style={{ color: "#6ee7b7" }}><span>Discount ({Number(v.discount_percent)}%)</span><span>− <Money value={v.discount_amount} currency={cur} /></span></div>}
        {Number(v.tax_rate) > 0 && <>
          <div className="row-between"><span>Taxable amount</span><Money value={v.taxable_amount} currency={cur} /></div>
          <div className="row-between"><span>{v.tax_label} ({Number(v.tax_rate)}%)</span><Money value={v.tax_amount} currency={cur} /></div>
        </>}
        <div className="row-between grand"><span>Final one-time total</span><Money value={v.total} currency={cur} /></div>
        {(Number(v.recurring_monthly) > 0 || Number(v.recurring_annual) > 0) && (
          <div className="stack-sm" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border-strong)" }}>
            <span className="tiny faint">Recurring — not included in the one-time total{Number(v.tax_rate) > 0 ? `; ${v.tax_label} as applicable` : ""}</span>
            {Number(v.recurring_monthly) > 0 && <div className="row-between"><span>Monthly</span><span><Money value={v.recurring_monthly} currency={cur} /> / month</span></div>}
            {Number(v.recurring_annual) > 0 && <div className="row-between"><span>Annual</span><span><Money value={v.recurring_annual} currency={cur} /> / year</span></div>}
          </div>
        )}
      </div>
      {recurring.length > 0 && (
        <ul className="small" style={{ marginTop: 10 }}>{recurring.map((r) => <li key={r.id}>{r.name}: <Money value={r.amount} currency={cur} /> {r.period === "annual" ? "per year" : "per month"}</li>)}</ul>
      )}

      {v.milestones.length > 0 && (
        <>
          <h3>Payment schedule</h3>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead><tr><th>Milestone</th><th>When</th><th className="num">Amount</th></tr></thead>
              <tbody>{v.milestones.map((m, i) => (
                <tr key={i}><td data-label="Milestone">{m.label}</td><td data-label="When" className="muted">{m.due ?? "—"}</td><td data-label="Amount" className="num"><Money value={m.amount} currency={cur} /></td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 6 }}>Initial amount payable: <Money value={v.initial_payable} currency={cur} />. Payments are shown as received only after they are confirmed.</p>
        </>
      )}

      {(c.scope.milestones.length > 0 || c.scope.timeline) && (
        <>
          <h3>Estimated delivery timeline</h3>
          {c.scope.milestones.length > 0 && <ul>{c.scope.milestones.map((m, i) => <li key={i}>{m.title}{m.estimate ? ` — ${m.estimate}` : ""}</li>)}</ul>}
          {c.scope.timeline && <p className="muted pre">{c.scope.timeline}</p>}
          <p className="tiny faint">Timelines are estimates and depend on timely feedback, content and approvals.</p>
        </>
      )}
      {!!c.scope.client_responsibilities.length && <><h3>Your responsibilities</h3><List items={c.scope.client_responsibilities} /></>}
      <Para title="Content and assets needed" text={c.scope.content_requirements} />
      <Para title="Testing and acceptance" text={c.scope.acceptance_criteria} />
      <h3>Revisions</h3>
      <p className="muted">{c.scope.revisions} round{c.scope.revisions === 1 ? "" : "s"} of revisions included.</p>
      <h3>Warranty &amp; maintenance</h3>
      <p className="muted pre">{c.warranty.days}-day post-launch warranty. {c.warranty.terms}</p>
      {maint && (
        <div className="glass" style={{ padding: 14, marginTop: 10, background: "rgba(0,0,0,.15)" }}>
          <div className="row-between"><strong style={{ fontWeight: 500 }}>{maint.name}</strong><span><Money value={maint.amount} currency={cur} /> {maint.period === "annual" ? "/ year" : "/ month"}</span></div>
          <ul className="small" style={{ marginTop: 6 }}>
            {md.included_hours && <li>{md.included_hours}</li>}
            {md.bug_fix_coverage && <li>Bug fixes: {md.bug_fix_coverage}</li>}
            {md.update_frequency && <li>Updates: {md.update_frequency}</li>}
            {md.backup_monitoring && <li>Backups &amp; monitoring: {md.backup_monitoring}</li>}
            {md.support_channel && <li>Support: {md.support_channel}</li>}
            {md.response_time && <li>Response time: {md.response_time}</li>}
            {md.exclusions && <li>Not included: {md.exclusions}</li>}
          </ul>
        </div>
      )}
      <div className="grid grid-2">
        {!!c.scope.exclusions.length && <div><h3>Exclusions</h3><List items={c.scope.exclusions} /></div>}
        {!!c.scope.assumptions.length && <div><h3>Assumptions</h3><List items={c.scope.assumptions} /></div>}
      </div>
      <Para title="Terms & conditions" text={c.terms} />
      {acceptance && (
        <div className="notice success" style={{ marginTop: 22 }}>
          Accepted electronically by <strong>{acceptance.signer_name}</strong> ({acceptance.user_email}) on {fmtDateTime(acceptance.accepted_at)} — version {v.version_no}.
          <span className="tiny" style={{ display: "block", opacity: 0.8 }}>This is a record of acceptance through the client portal, not a certified digital signature.</span>
          <span className="tiny" style={{ display: "block", opacity: 0.8, wordBreak: "break-all" }}>Content fingerprint: {acceptance.content_hash}</span>
        </div>
      )}
    </article>
  );
}
