import { requireClient } from "@/lib/session";
import { getBilling } from "@/server/billing";
import { Empty, InvoiceBadge, Money, PageHead, Panel } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate, PAYMENT_METHODS } from "@/lib/format";
import { integrations } from "@/lib/config";
import { PayOnline } from "./pay-online";

export const metadata = { title: "Invoices & payments" };

export default async function PaymentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const b = await getBilling(actor, projectId);
  const online = integrations().razorpay;
  const cur = b.quotation?.currency ?? "INR";
  return (
    <>
      <PageHead eyebrow="Billing" title="Invoices & payments" sub="Only payments that have been received and confirmed are shown as paid." />
      <div className="grid grid-3">
        <Panel><span className="tiny faint">Project total</span><div className="stat-value"><Money value={b.contractTotal} currency={cur} /></div>
          <span className="tiny faint">{b.quotation ? `Accepted quotation ${b.quotation.number} v${b.quotation.version_no}` : "Awaiting quotation acceptance"}</span></Panel>
        <Panel><span className="tiny faint">Paid so far</span><div className="stat-value" style={{ color: "#6ee7b7" }}><Money value={b.paidTotal} currency={cur} /></div>
          <span className="tiny faint">{b.payments.filter((p) => p.status === "confirmed").length} confirmed payment(s)</span></Panel>
        <Panel><span className="tiny faint">Remaining balance</span><div className="stat-value"><Money value={b.remaining} currency={cur} /></div>
          <span className="tiny faint">{b.advanceRequired != null ? <>{b.advanceLabel}: <Money value={b.advanceRequired} currency={cur} /></> : "—"}</span></Panel>
      </div>

      {b.overdueInvoices.length > 0 && <div className="notice warn section">{b.overdueInvoices.length} invoice(s) are past their due date. If you have already paid, please share the payment reference in Messages.</div>}

      {b.terms.length > 0 && (
        <Panel title="Payment schedule" className="section">
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Milestone</th><th>When</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{b.terms.map((t) => (
              <tr key={t.label}>
                <td data-label="Milestone" style={{ fontWeight: 500 }}>{t.label} <span className="faint small">({t.percent}%)</span></td>
                <td data-label="When" className="muted">{t.due}</td>
                <td data-label="Amount" className="num"><Money value={t.amount} currency={cur} /></td>
                <td data-label="Status">{t.invoice && t.invoice.status !== "draft" ? <InvoiceBadge status={t.invoice.status} overdue={t.invoice.overdue} /> : <span className="small faint">Not yet invoiced</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      <Panel title="Invoices" className="section">
        {b.invoices.length === 0 ? <Empty icon="receipt" title="No invoices yet">Invoices will appear here when they are issued.</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="num">Amount</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>{b.invoices.map((i) => (
              <tr key={i.id}>
                <td data-label="Invoice"><div style={{ fontWeight: 500 }}>{i.number}</div><div className="small faint">{i.title}</div></td>
                <td data-label="Issued">{fmtDate(i.issue_date)}</td><td data-label="Due">{fmtDate(i.due_date)}</td>
                <td data-label="Amount" className="num"><Money value={i.amount} currency={i.currency} /></td>
                <td data-label="Balance" className="num"><Money value={i.balance} currency={i.currency} /></td>
                <td data-label="Status"><InvoiceBadge status={i.status} overdue={i.overdue} /></td>
                <td data-label="" className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                  {online && i.balance > 0 && ["issued", "partially_paid"].includes(i.status) && <PayOnline invoiceId={i.id} />}
                  <a className="btn btn-sm" href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /> PDF</a>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Payment history" className="section">
        {b.payments.length === 0 ? <Empty icon="wallet" title="No confirmed payments yet">When a payment is received and confirmed, it will be listed here with a receipt.</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>{b.payments.map((p) => (
              <tr key={p.id}>
                <td data-label="Date">{fmtDate(p.paid_on)}</td><td data-label="Receipt">{p.receipt_number ?? "—"}{p.status === "refunded" && <span className="badge red" style={{ marginLeft: 6 }}>Refunded</span>}</td>
                <td data-label="Method">{PAYMENT_METHODS[p.method]}</td><td data-label="Reference" className="small muted">{p.reference ?? "—"}</td>
                <td data-label="Amount" className="num"><Money value={p.amount} currency={p.currency} /></td>
                <td data-label="" className="right">{p.receipt_number && <a className="btn btn-sm" href={`/api/payments/${p.id}/receipt`} target="_blank" rel="noopener"><Icon name="receipt" /> Receipt</a>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
