import { requireClient } from "@/lib/session";
import { maintenanceDetail, maintenanceTerms, getPaymentDetails, fmtIST } from "@/server/maintenance";
import { Badge, Empty, InvoiceBadge, MaintenanceBadge, Money, PageHead, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { PayBox } from "@/components/views/pay-box";
import { activateMaintenanceAction, cancelMaintenanceAction } from "@/app/actions/maintenance";
import { getBilling } from "@/server/billing";

export const metadata = { title: "Maintenance & billing" };

export default async function ClientMaintenance({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const [d, terms, pd, billing] = await Promise.all([maintenanceDetail(actor, projectId), maintenanceTerms(projectId), getPaymentDetails(), getBilling(actor, projectId)]);
  const p = d.project;
  const active = !!p.maintenance_activated_at && !p.maintenance_cancelled_at;
  const expired = p.days_left != null && p.days_left <= 0;
  const balances = new Map(billing.invoices.map((i) => [i.id, i.balance]));
  const taxNote = terms.tax.enabled && terms.tax.rate > 0 ? ` + ${terms.tax.label} ${terms.tax.rate}%` : "";

  if (!p.free_maintenance_end_date) {
    return (<><PageHead eyebrow="Support" title="Maintenance & billing" />
      <Panel><Empty icon="wrench" title="Maintenance hasn't started yet">Your six months of free maintenance begin once your proposal is created. The dates will appear here.</Empty></Panel></>);
  }
  if (p.maintenance_exempt) {
    return (<><PageHead eyebrow="Support" title="Maintenance & billing" />
      <Panel><p style={{ margin: 0 }}>Maintenance for this project is covered under your agreement. There are no maintenance charges.</p></Panel></>);
  }
  return (
    <>
      <PageHead eyebrow="Support" title="Maintenance & billing" sub="Your free maintenance period, the optional paid plan, and maintenance invoices." />

      {expired && !active && (
        <div className="notice warn section" style={{ marginTop: 0 }}>
          Your six-month free maintenance period has ended. Continue with our maintenance plan for <Money value={terms.fee} /> per month{taxNote}.
        </div>
      )}

      <div className="grid grid-4">
        <div className="panel"><span className="tiny faint">Status</span><div style={{ marginTop: 6 }}><MaintenanceBadge status={p.maintenance_status} /></div></div>
        <div className="panel"><span className="tiny faint">Free maintenance</span><div className="small" style={{ marginTop: 6 }}>{fmtIST(p.free_maintenance_start_date)} – {fmtIST(p.free_maintenance_end_date)}</div></div>
        <div className="panel"><span className="tiny faint">{expired ? "Free period" : "Days remaining"}</span><div className="stat-value">{expired ? "Ended" : p.days_left}</div></div>
        <div className="panel"><span className="tiny faint">{active ? "Next billing date" : "Plan after free period"}</span>
          <div className="stat-value" style={{ fontSize: active ? "1.1rem" : undefined }}>{active ? fmtIST(p.next_billing_date) : <><Money value={terms.fee} /><span className="tiny faint">/month</span></>}</div></div>
      </div>

      <div className="grid grid-2 section" style={{ alignItems: "start" }}>
        <Panel title="What maintenance covers">
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>{terms.included.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="tiny faint" style={{ marginTop: 14, marginBottom: 6 }}>Not included (quoted separately):</p>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{terms.excluded.map((x) => <li key={x}>{x}</li>)}</ul>
        </Panel>

        {active ? (
          <Panel title="Your maintenance plan" sub={<><Money value={terms.fee} /> per month{taxNote} · billing started {fmtIST(p.maintenance_billing_start_date)}</>}>
            <p className="small muted">{terms.payment_terms}</p>
            <details>
              <summary className="btn btn-sm btn-ghost">Manage or cancel</summary>
              <ActionForm action={cancelMaintenanceAction.bind(null, projectId)} className="stack" toast>
                <p className="small muted" style={{ margin: "10px 0 0" }}>{terms.cancellation_terms}</p>
                <label className="field"><span className="label">Reason (optional)</span><input name="reason" className="input" maxLength={500} /></label>
                <div><Submit className="btn btn-danger btn-sm" confirm="Cancel your maintenance plan?">Cancel maintenance plan</Submit></div>
              </ActionForm>
            </details>
          </Panel>
        ) : (
          <Panel title={p.maintenance_cancelled_at ? "Restart paid maintenance" : "Continue with paid maintenance"}
            sub={expired ? "Keep your project maintained after the free period." : `Optional. You can opt in now; billing starts only after your free period ends on ${fmtIST(p.free_maintenance_end_date)}.`}>
            <dl className="kv" style={{ marginBottom: 14 }}>
              <div><dt>Monthly fee</dt><dd><Money value={terms.fee} /></dd></div>
              <div><dt>Tax</dt><dd>{taxNote ? `${terms.tax.label} ${terms.tax.rate}%` : "None"}</dd></div>
              <div><dt>Total per month</dt><dd><Money value={terms.total} /></dd></div>
              <div><dt>Frequency</dt><dd>{terms.frequency}</dd></div>
            </dl>
            <p className="small muted" style={{ marginTop: 0 }}><strong>Payment:</strong> {terms.payment_terms}</p>
            <p className="small muted"><strong>Cancellation:</strong> {terms.cancellation_terms}</p>
            <p className="small muted">We never charge you automatically. Each month you receive an invoice and pay it by UPI or bank transfer.</p>
            <ActionForm action={activateMaintenanceAction.bind(null, projectId)} className="stack" toast>
              <label className="check"><input type="checkbox" name="confirm_terms" required /> <span>I have read what maintenance includes and excludes, and the payment and cancellation terms.</span></label>
              <label className="check"><input type="checkbox" name="confirm_recurring" required /> <span>I agree to pay <Money value={terms.total} /> every month until I cancel.</span></label>
              <label className="field"><span className="label">Type your full name to confirm</span><input name="signer_name" className="input" required minLength={2} maxLength={200} autoComplete="name" /></label>
              <div><Submit>Activate maintenance plan</Submit></div>
            </ActionForm>
          </Panel>
        )}
      </div>

      <Panel title="Maintenance invoices" className="section">
        {d.invoices.length === 0 ? <Empty icon="receipt" title="No maintenance invoices">{active ? "Your first invoice will appear a few days before your billing date." : "Invoices only start if you activate the paid plan."}</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Invoice</th><th>Period</th><th>Due</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>{d.invoices.filter((i) => i.status !== "void").map((i) => {
              const unpaid = ["issued", "partially_paid"].includes(i.status);
              const reported = d.payments.some((x) => x.invoice_id === i.id && x.status === "pending");
              return (
                <tr key={i.id}>
                  <td data-label="Invoice" style={{ fontWeight: 500 }}>{i.number}</td>
                  <td data-label="Period" className="small">{fmtIST(i.billing_period_start)} – {fmtIST(i.billing_period_end)}</td>
                  <td data-label="Due" className="small">{fmtIST(i.due_date)}</td>
                  <td data-label="Amount" className="num"><Money value={Number(i.amount)} /></td>
                  <td data-label="Status"><InvoiceBadge status={i.status} overdue={unpaid && !!i.due_date && i.due_date < d.today} />{reported && <Badge plain>Payment reported</Badge>}</td>
                  <td data-label="" className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                    {unpaid && <PayBox invoice={{ id: i.id, number: i.number, balance: balances.get(i.id) ?? Number(i.amount) }} pd={pd} reported={reported} />}
                    <a className="btn btn-sm" href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /> PDF</a>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Payment history" className="section">
        {d.payments.filter((x) => x.status !== "pending").length === 0 ? <p className="small muted">No confirmed maintenance payments yet.</p> : (
          <div className="list">{d.payments.filter((x) => x.status !== "pending").map((x) => (
            <div key={x.id} className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}><Money value={Number(x.amount)} /></strong>
              <div className="tiny faint">{fmtIST(x.paid_on)} · {x.reference ?? ""}</div></div>
              {x.receipt_number && <a className="btn btn-sm" href={`/api/payments/${x.id}/receipt`} target="_blank" rel="noopener"><Icon name="receipt" /> Receipt</a>}
            </div>
          ))}</div>
        )}
      </Panel>
    </>
  );
}
