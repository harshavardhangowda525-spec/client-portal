import { requireAdmin } from "@/lib/session";
import { getBilling } from "@/server/billing";
import { Empty, InvoiceBadge, Money, Panel, PaymentBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { fmtDate, PAYMENT_METHODS } from "@/lib/format";
import { voidInvoiceAction, setPaymentStatusAction } from "@/app/actions/admin";
import { CustomInvoiceForm, IssueInvoice, RecordPaymentForm, TermInvoice } from "./forms";
import { integrations } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function AdminBilling({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const b = await getBilling(actor, projectId);
  const cur = b.quotation?.currency ?? "INR";
  const payable = b.invoices.filter((i) => ["issued", "partially_paid"].includes(i.status));
  return (
    <div className="stack">
      <div className="grid grid-3">
        <Panel><span className="tiny faint">Accepted quotation total</span><div className="stat-value"><Money value={b.contractTotal} currency={cur} /></div><span className="tiny faint">{b.quotation ? `${b.quotation.number} v${b.quotation.version_no}` : "No accepted quotation yet"}</span></Panel>
        <Panel><span className="tiny faint">Confirmed received</span><div className="stat-value" style={{ color: "#6ee7b7" }}><Money value={b.paidTotal} currency={cur} /></div><span className="tiny faint">Remaining <Money value={b.remaining} currency={cur} /></span></Panel>
        <Panel><span className="tiny faint">Outstanding on issued invoices</span><div className="stat-value"><Money value={b.outstandingInvoiced} currency={cur} /></div>
          <span className="tiny" style={{ color: b.overdueInvoices.length ? "var(--red)" : "var(--text-3)" }}>{b.overdueInvoices.length} overdue</span></Panel>
      </div>
      <div className="notice info small">Online payments: {integrations().razorpay ? "Razorpay is connected — clients can pay issued invoices online; payments are confirmed only after server-side verification." : "Razorpay is not connected. Record payments manually below once you have verified receipt."}</div>

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Payment schedule" sub="From the accepted quotation.">
            {b.terms.length === 0 ? <p className="small muted">Payment milestones appear once the client accepts a quotation.</p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Milestone</th><th className="num">Amount</th><th>Invoice</th></tr></thead>
                <tbody>{b.terms.map((t, idx) => (
                  <tr key={t.label}>
                    <td><div style={{ fontWeight: 500 }}>{t.label} <span className="faint small">({t.percent}%)</span></div><div className="tiny faint">{t.due}</div></td>
                    <td className="num"><Money value={t.amount} currency={cur} /></td>
                    <td>{t.invoice ? <span className="row">{t.invoice.number} <InvoiceBadge status={t.invoice.status} overdue={t.invoice.overdue} /></span> : <TermInvoice projectId={projectId} index={idx} />}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>

          <Panel title="Invoices">
            {b.invoices.length === 0 ? <Empty icon="receipt" title="No invoices yet" /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Invoice</th><th>Due</th><th className="num">Amount</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
                <tbody>{b.invoices.map((i) => (
                  <tr key={i.id}>
                    <td><div style={{ fontWeight: 500 }}>{i.number}</div><div className="tiny faint">{i.title}</div></td>
                    <td>{fmtDate(i.due_date)}</td>
                    <td className="num"><Money value={i.amount} currency={i.currency} /></td>
                    <td className="num"><Money value={i.balance} currency={i.currency} /></td>
                    <td><InvoiceBadge status={i.status} overdue={i.overdue} /></td>
                    <td><div className="row" style={{ justifyContent: "flex-end" }}>
                      {i.status === "draft" && <IssueInvoice invoiceId={i.id} due={i.due_date} />}
                      <a className="btn btn-sm btn-ghost" href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /><span className="sr-only">PDF</span></a>
                      {i.status !== "void" && i.paid === 0 && <ActionButton action={voidInvoiceAction.bind(null, i.id)} className="btn btn-sm btn-ghost" confirm={`Void invoice ${i.number}?`}>Void</ActionButton>}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <details style={{ marginTop: 12 }}><summary className="btn btn-sm">+ Custom invoice</summary><div style={{ marginTop: 12 }}><CustomInvoiceForm projectId={projectId} /></div></details>
          </Panel>

          <Panel title="Payment history">
            {b.payments.length === 0 ? <p className="small muted">No payments recorded.</p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Date</th><th>Method / reference</th><th>Invoice</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
                <tbody>{b.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.paid_on)}</td>
                    <td>{PAYMENT_METHODS[p.method]}<div className="tiny faint">{p.reference ?? "—"}{p.source === "razorpay" ? " · verified online" : ""}</div></td>
                    <td className="small">{p.invoice_number ?? "—"}</td>
                    <td className="num"><Money value={p.amount} currency={p.currency} /></td>
                    <td><PaymentBadge status={p.status} />{p.receipt_number && <div className="tiny faint">{p.receipt_number}</div>}</td>
                    <td><div className="row" style={{ justifyContent: "flex-end" }}>
                      {p.status === "pending" && <>
                        <ActionButton action={setPaymentStatusAction.bind(null, p.id, "confirmed")} className="btn btn-sm btn-success" confirm="Confirm you have verified this payment was received?">Confirm</ActionButton>
                        <ActionButton action={setPaymentStatusAction.bind(null, p.id, "failed")} className="btn btn-sm btn-ghost">Failed</ActionButton>
                      </>}
                      {p.status === "confirmed" && <a className="btn btn-sm btn-ghost" href={`/api/payments/${p.id}/receipt`} target="_blank" rel="noopener"><Icon name="receipt" /><span className="sr-only">Receipt</span></a>}
                      {p.status === "confirmed" && <ActionButton action={setPaymentStatusAction.bind(null, p.id, "refunded")} className="btn btn-sm btn-ghost" confirm="Mark this payment as refunded?">Refund</ActionButton>}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <Panel title="Record a payment" sub="Only confirm once you have verified the money was received.">
          <RecordPaymentForm projectId={projectId} invoices={payable.map((i) => ({ id: i.id, label: `${i.number} — balance ${i.balance.toLocaleString("en-IN")}`, balance: i.balance }))} />
        </Panel>
      </div>
    </div>
  );
}
