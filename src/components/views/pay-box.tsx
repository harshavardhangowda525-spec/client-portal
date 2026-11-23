"use client";

import { useState } from "react";
import { ActionForm, Modal, Submit, CopyButton } from "@/components/forms";
import { Money } from "@/components/ui";
import { Icon } from "@/components/icons";
import { reportPaymentAction } from "@/app/actions/maintenance";
import type { PaymentDetails } from "@/server/maintenance";
import { upiLink } from "@/lib/upi";
import { istToday } from "@/lib/dates";

/**
 * "Pay by UPI" pop-up: an animated scanner around the invoice's UPI QR code, an "Open UPI app" button for phones,
 * bank details, and the "I've paid" report. Paying never marks the invoice paid by itself — an admin confirms it.
 */
export function PayBox({ invoice, pd, reported, label = "Pay by UPI" }: { invoice: { id: string; number: string; balance: number }; pd: PaymentDetails; reported?: boolean; label?: string }) {
  const bank = pd.account_number && pd.ifsc;
  if (!pd.upi_id && !bank) return null;
  return (
    <Modal title={`Pay ${invoice.number}`} triggerClass="btn btn-sm btn-primary" trigger={<><Icon name="qr" /> {pd.upi_id ? label : "Pay"}</>}>
      {(close) => <PayBody invoice={invoice} pd={pd} reported={reported} close={close} />}
    </Modal>
  );
}

function PayBody({ invoice, pd, reported, close }: { invoice: { id: string; number: string; balance: number }; pd: PaymentDetails; reported?: boolean; close: () => void }) {
  const bank = pd.account_number && pd.ifsc;
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<"scan" | "report">("scan");
  const href = pd.upi_id ? upiLink(pd, invoice.balance, invoice.number) : "";

  return (
    <div className="stack pay-sheet">
      <div className="pay-amount">
        <span className="tiny faint">Amount to pay</span>
        <strong><Money value={invoice.balance} /></strong>
        <span className="tiny faint">to {pd.payee_name || pd.account_holder}</span>
      </div>

      {step === "scan" && pd.upi_id && (
        <>
          <div className={`scanner${loaded ? " is-ready" : ""}`}>
            <div className="scanner-ring" aria-hidden="true" />
            <div className="scanner-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/invoices/${invoice.id}/upi-qr`} alt={`UPI QR code to pay ${invoice.number}`} onLoad={() => setLoaded(true)} />
              <span className="scanner-corner tl" aria-hidden="true" /><span className="scanner-corner tr" aria-hidden="true" />
              <span className="scanner-corner bl" aria-hidden="true" /><span className="scanner-corner br" aria-hidden="true" />
              <span className="scanner-line" aria-hidden="true" />
              {!loaded && <span className="scanner-loading tiny faint">Preparing your code…</span>}
            </div>
          </div>
          <p className="small center muted" style={{ margin: 0 }}>Scan with any UPI app. The amount is filled in for you.</p>
          <div className="upi-apps" aria-label="Works with">
            {["Google Pay", "PhonePe", "Paytm", "BHIM"].map((a) => <span key={a} className="upi-app">{a}</span>)}
          </div>
          {/* Touch screens (phones, tablets) get a button that opens the UPI app with everything filled in; hidden on mouse-only screens by CSS. */}
          <a className="btn btn-primary upi-open" href={href}>Open UPI app on this phone</a>
          <div className="upi-id-row">
            <span className="tiny faint">UPI ID</span>
            <span className="mono small">{pd.upi_id}</span>
            <CopyButton text={pd.upi_id} />
          </div>
        </>
      )}

      {step === "scan" && bank && (
        <details className="pay-bank">
          <summary className="small">Pay by bank transfer instead</summary>
          <dl className="kv" style={{ marginTop: 10 }}>
            <div><dt>Account holder</dt><dd>{pd.account_holder || pd.payee_name}</dd></div>
            <div><dt>Account number</dt><dd className="mono">{pd.account_number}</dd></div>
            <div><dt>IFSC</dt><dd className="mono">{pd.ifsc}</dd></div>
            {pd.bank_name && <div><dt>Bank</dt><dd>{pd.bank_name}{pd.branch ? `, ${pd.branch}` : ""}</dd></div>}
          </dl>
        </details>
      )}
      {pd.instructions && step === "scan" && <p className="small muted" style={{ margin: 0 }}>{pd.instructions}</p>}

      {reported ? (
        <div className="notice info">You told us about a payment for this invoice. It shows as paid once we confirm it.</div>
      ) : step === "scan" ? (
        <button type="button" className="btn" onClick={() => setStep("report")}>I&apos;ve paid — send the reference</button>
      ) : (
        <ActionForm action={reportPaymentAction.bind(null, invoice.id)} className="form-grid pay-report" toast onDone={() => close()}>
          <p className="small full" style={{ margin: 0 }}>Enter the UPI reference (UTR) or bank transaction ID from your payment app so we can match it.</p>
          <label className="field"><span className="label">UTR / transaction ID</span><input name="reference" className="input" required minLength={4} maxLength={100} autoFocus /></label>
          <label className="field"><span className="label">Amount paid (₹)</span><input name="amount" type="number" min="1" step="0.01" className="input" defaultValue={invoice.balance} required /></label>
          <label className="field"><span className="label">Paid on</span><input name="paid_on" type="date" className="input" defaultValue={istToday()} max={istToday()} required /></label>
          <div className="form-actions full"><button type="button" className="btn btn-ghost" onClick={() => setStep("scan")}>Back to QR</button><Submit>I&apos;ve paid</Submit></div>
        </ActionForm>
      )}
      <p className="tiny faint center" style={{ margin: 0 }}>Your invoice shows as paid only after we confirm the money has arrived.</p>
    </div>
  );
}
