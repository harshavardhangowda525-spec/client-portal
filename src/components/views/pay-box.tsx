"use client";

import { ActionForm, Modal, Submit, CopyButton } from "@/components/forms";
import { Money } from "@/components/ui";
import { Icon } from "@/components/icons";
import { reportPaymentAction } from "@/app/actions/maintenance";
import type { PaymentDetails } from "@/server/maintenance";
import { istToday } from "@/lib/dates";

/** Scan-to-pay UPI QR + bank details + "I've paid" report for one unpaid invoice. */
export function PayBox({ invoice, pd, reported }: { invoice: { id: string; number: string; balance: number }; pd: PaymentDetails; reported?: boolean }) {
  const bank = pd.account_number && pd.ifsc;
  if (!pd.upi_id && !bank) return null;
  return (
    <Modal title={`Pay ${invoice.number}`} triggerClass="btn btn-sm btn-primary" trigger={<><Icon name="qr" /> Pay</>}>
      {(close) => (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>Amount due: <strong style={{ color: "var(--text)" }}><Money value={invoice.balance} /></strong></p>
          {pd.upi_id && (
            <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/invoices/${invoice.id}/upi-qr`} alt={`UPI QR code to pay ${invoice.number}`} className="qr-box" />
              <div className="stack" style={{ gap: 6, minWidth: 180, flex: 1 }}>
                <span className="small">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM…). The amount is filled in for you.</span>
                <span className="tiny faint">UPI ID</span>
                <div className="row" style={{ gap: 6 }}><span className="mono small">{pd.upi_id}</span><CopyButton text={pd.upi_id} /></div>
                <span className="tiny faint">Payee: {pd.payee_name}</span>
              </div>
            </div>
          )}
          {bank && (
            <dl className="kv">
              <div><dt>Account holder</dt><dd>{pd.account_holder || pd.payee_name}</dd></div>
              <div><dt>Account number</dt><dd className="mono">{pd.account_number}</dd></div>
              <div><dt>IFSC</dt><dd className="mono">{pd.ifsc}</dd></div>
              {pd.bank_name && <div><dt>Bank</dt><dd>{pd.bank_name}{pd.branch ? `, ${pd.branch}` : ""}</dd></div>}
            </dl>
          )}
          {pd.instructions && <p className="small muted" style={{ margin: 0 }}>{pd.instructions}</p>}
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
          {reported ? <div className="notice info">You reported a payment for this invoice. We&apos;ll confirm it shortly; it shows as paid once confirmed.</div> : (
            <ActionForm action={reportPaymentAction.bind(null, invoice.id)} className="form-grid" toast onDone={() => close()}>
              <p className="small full" style={{ margin: 0 }}><strong>Already paid?</strong> Tell us the UPI reference (UTR) or bank transaction ID so we can confirm it.</p>
              <label className="field"><span className="label">UTR / transaction ID</span><input name="reference" className="input" required minLength={4} maxLength={100} /></label>
              <label className="field"><span className="label">Amount paid (₹)</span><input name="amount" type="number" min="1" step="0.01" className="input" defaultValue={invoice.balance} required /></label>
              <label className="field"><span className="label">Paid on</span><input name="paid_on" type="date" className="input" defaultValue={istToday()} max={istToday()} required /></label>
              <div className="form-actions full"><Submit>I&apos;ve paid</Submit></div>
            </ActionForm>
          )}
        </div>
      )}
    </Modal>
  );
}
