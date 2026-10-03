import { Money, QuoteBadge } from "../ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { QuoteItem, QuoteVersion } from "@/server/quotations";

export function QuotationDocument({ v, items, acceptance, companyName }: {
  v: QuoteVersion & { number: string; title: string }; items: QuoteItem[];
  acceptance: { signer_name: string; accepted_at: Date; content_hash: string; user_name: string; user_email: string } | null;
  companyName: string;
}) {
  const c = v.client_snapshot;
  return (
    <article className="glass doc" aria-label={`Quotation ${v.number}`}>
      <header className="doc-head">
        <div className="stack-sm">
          <span className="eyebrow" style={{ margin: 0 }}>{companyName}</span>
          <h2 style={{ fontSize: "1.35rem" }}>{v.title}</h2>
          <span className="small muted">Quotation {v.number} · Version {v.version_no}</span>
        </div>
        <div className="stack-sm" style={{ alignItems: "flex-end" }}>
          <QuoteBadge status={v.status} />
          <span className="small muted">Issued {fmtDate(v.issue_date)}</span>
          <span className="small muted">Valid until {fmtDate(v.valid_until)}</span>
        </div>
      </header>
      <div className="grid grid-2">
        <div className="stack-sm">
          <span className="tiny faint">Prepared for</span>
          <strong style={{ fontWeight: 500 }}>{c.owner_name}</strong>
          <span className="small muted">{c.business_name}</span>
          <span className="small muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
        </div>
        {v.delivery_timeline && (
          <div className="stack-sm"><span className="tiny faint">Estimated delivery</span><span className="small">{v.delivery_timeline}</span></div>
        )}
      </div>
      {v.project_description && <><h3>Project description</h3><p className="muted pre">{v.project_description}</p></>}

      <h3>Services &amp; pricing</h3>
      <div className="table-wrap">
        <table className="table table-cards">
          <thead><tr><th>Service</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.position}>
                <td data-label=""><div style={{ fontWeight: 500, textAlign: "left" }}>{i.description}</div>{i.details && <div className="small faint">{i.details}</div>}</td>
                <td data-label="Qty" className="num">{Number(i.quantity)}</td>
                <td data-label="Unit price" className="num"><Money value={i.unit_price} currency={v.currency} /></td>
                <td data-label="Amount" className="num"><Money value={i.amount} currency={v.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="totals">
        <div className="row-between"><span>Subtotal</span><Money value={v.subtotal} currency={v.currency} /></div>
        {Number(v.discount_amount) > 0 && <div className="row-between"><span>Discount{v.discount_type === "percent" ? ` (${Number(v.discount_value)}%)` : ""}</span><span>− <Money value={v.discount_amount} currency={v.currency} /></span></div>}
        {Number(v.tax_rate) > 0 && <div className="row-between"><span>{v.tax_label} ({Number(v.tax_rate)}%)</span><Money value={v.tax_amount} currency={v.currency} /></div>}
        <div className="row-between grand"><span>Total</span><Money value={v.total} currency={v.currency} /></div>
      </div>

      {v.payment_terms.length > 0 && (
        <>
          <h3>Payment milestones</h3>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead><tr><th>Milestone</th><th>When</th><th className="num">Share</th><th className="num">Amount</th></tr></thead>
              <tbody>{v.payment_terms.map((t) => (
                <tr key={t.label}><td data-label="Milestone">{t.label}</td><td data-label="When" className="muted">{t.due}</td><td data-label="Share" className="num">{t.percent}%</td><td data-label="Amount" className="num"><Money value={t.amount} currency={v.currency} /></td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 6 }}>Payments are shown as received only after they have been confirmed.</p>
        </>
      )}
      <div className="grid grid-2">
        {v.included_features.length > 0 && <div><h3>Included</h3><ul>{v.included_features.map((f) => <li key={f}>{f}</li>)}</ul></div>}
        {v.exclusions.length > 0 && <div><h3>Not included</h3><ul>{v.exclusions.map((f) => <li key={f}>{f}</li>)}</ul></div>}
      </div>
      <h3>Revisions</h3>
      <p className="muted">{v.revisions_included} round{v.revisions_included === 1 ? "" : "s"} of revisions included. Additional revisions are quoted separately.</p>
      {v.maintenance_terms && <><h3>Maintenance &amp; support</h3><p className="muted pre">{v.maintenance_terms}</p></>}
      {v.domain_hosting_terms && <><h3>Domain &amp; hosting</h3><p className="muted pre">{v.domain_hosting_terms}</p></>}
      {v.terms_conditions && <><h3>Terms &amp; conditions</h3><p className="muted pre small">{v.terms_conditions}</p></>}
      {v.client_response_note && v.status !== "accepted" && (
        <><h3>Client response</h3><p className="muted pre">{v.client_response_note}</p></>
      )}
      {acceptance && (
        <div className="notice success" style={{ marginTop: 22 }}>
          Accepted by <strong>{acceptance.signer_name}</strong> ({acceptance.user_email}) on {fmtDateTime(acceptance.accepted_at)}.
          <span className="tiny" style={{ display: "block", opacity: 0.8, wordBreak: "break-all" }}>Content fingerprint: {acceptance.content_hash}</span>
        </div>
      )}
    </article>
  );
}
