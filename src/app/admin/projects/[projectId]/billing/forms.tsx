"use client";

import { ActionForm, Submit } from "@/components/forms";
import { createInvoiceAction, invoiceFromTermAction, issueInvoiceAction, recordPaymentAction } from "@/app/actions/admin";
import { PAYMENT_METHODS } from "@/lib/format";

export function TermInvoice({ projectId, index }: { projectId: string; index: number }) {
  return (
    <ActionForm action={invoiceFromTermAction.bind(null, projectId, index)} className="row" toast>
      <input name="due_date" type="date" className="input" style={{ width: 150 }} aria-label="Due date" />
      <Submit className="btn btn-sm">Create invoice</Submit>
    </ActionForm>
  );
}

export function IssueInvoice({ invoiceId, due }: { invoiceId: string; due: string | null }) {
  return (
    <ActionForm action={issueInvoiceAction.bind(null, invoiceId)} className="row" toast>
      <input name="due_date" type="date" className="input" style={{ width: 150 }} defaultValue={due ?? ""} aria-label="Due date" />
      <Submit className="btn btn-sm btn-primary" confirm="Issue this invoice to the client?">Issue</Submit>
    </ActionForm>
  );
}

export function CustomInvoiceForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={createInvoiceAction.bind(null, projectId)} className="form-grid" resetOnSuccess>
      <div className="field full"><label htmlFor="ci-title">Title</label><input id="ci-title" name="title" className="input" required maxLength={200} placeholder="Additional revision work" /></div>
      <div className="field"><label htmlFor="ci-amt">Amount (₹)</label><input id="ci-amt" name="amount" type="number" min="0.01" step="0.01" className="input" required /></div>
      <div className="field"><label htmlFor="ci-due">Due date</label><input id="ci-due" name="due_date" type="date" className="input" /></div>
      <div className="field full"><label htmlFor="ci-desc">Description</label><textarea id="ci-desc" name="description" className="textarea" maxLength={5000} /></div>
      <div className="form-actions full"><Submit>Create draft invoice</Submit></div>
    </ActionForm>
  );
}

export function RecordPaymentForm({ projectId, invoices }: { projectId: string; invoices: { id: string; label: string; balance: number }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={recordPaymentAction.bind(null, projectId)} className="stack" resetOnSuccess>
      <div className="field"><label htmlFor="rp-inv">Invoice</label>
        <select id="rp-inv" name="invoice_id" className="select"><option value="">Not linked to an invoice</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="rp-amt">Amount (₹)</label><input id="rp-amt" name="amount" type="number" min="0.01" step="0.01" className="input" required /></div>
        <div className="field"><label htmlFor="rp-date">Payment date</label><input id="rp-date" name="paid_on" type="date" className="input" defaultValue={today} max={today} required /></div>
      </div>
      <div className="field"><label htmlFor="rp-method">Method</label>
        <select id="rp-method" name="method" className="select">{Object.entries(PAYMENT_METHODS).filter(([v]) => v !== "razorpay").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor="rp-ref">Transaction reference</label><input id="rp-ref" name="reference" className="input" maxLength={200} placeholder="UTR / UPI ref / cheque no." /></div>
      <div className="field"><label htmlFor="rp-notes">Notes</label><textarea id="rp-notes" name="notes" className="textarea" style={{ minHeight: 60 }} maxLength={2000} /></div>
      <div className="field"><label htmlFor="rp-status">Confirmation</label>
        <select id="rp-status" name="status" className="select" defaultValue="pending"><option value="pending">Awaiting confirmation (not shown to client)</option><option value="confirmed">Confirmed — I verified receipt</option></select></div>
      <Submit pendingText="Recording…">Record payment</Submit>
    </ActionForm>
  );
}
