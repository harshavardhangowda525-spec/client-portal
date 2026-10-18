import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { getMaintenanceSettings, getPaymentDetails, upiLink, DEFAULT_TEMPLATES, NOTIFICATION_KINDS, type NotificationKind } from "@/server/maintenance";
import { PageHead, Panel, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveMaintenanceSettingsAction, savePaymentDetailsAction, saveTemplateAction } from "@/app/actions/maintenance";
import QRCode from "qrcode";

export const metadata = { title: "Maintenance & payment settings" };
export const dynamic = "force-dynamic";

const F = ({ label, children, full, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) => (
  <label className={`field${full ? " full" : ""}`}><span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
);
const PLACEHOLDERS = "{{client_name}} {{business_name}} {{project_name}} {{expiry_date}} {{days_left}} {{monthly_fee}} {{amount}} {{due_date}} {{invoice_number}} {{receipt_number}} {{next_billing_date}} {{payment_link}} {{portal_link}} {{company_name}} {{company_contact}} {{maintenance_status}}";

export default async function MaintenanceSettings() {
  const actor = await requireAdmin();
  void actor;
  const [s, pd] = await Promise.all([getMaintenanceSettings(), getPaymentDetails()]);
  const preview = pd.upi_id ? await QRCode.toString(upiLink(pd, s.default_fee, "Maintenance (preview)"), { type: "svg", margin: 2, width: 200 }) : null;
  return (
    <>
      <PageHead eyebrow={<Link href="/admin/settings">Settings</Link>} title="Maintenance & payments"
        sub="Free maintenance period, paid maintenance terms, notification templates, and the bank/UPI details clients use to pay." />
      <nav className="tabs" aria-label="Sections"><a href="#payment">Payment details</a><a href="#plan">Maintenance plan</a><a href="#notify">Notifications</a><a href="#templates">Templates</a></nav>

      <div className="grid grid-2" style={{ alignItems: "start" }} id="payment">
        <Panel title="Payment details (UPI & bank)" sub="Shown to clients on every unpaid invoice with a scan-to-pay UPI QR code. Payments count only after you confirm them.">
          <ActionForm action={savePaymentDetailsAction} className="form-grid" toast>
            <F label="UPI ID" hint="e.g. yourname@okhdfcbank"><input name="upi_id" className="input" defaultValue={pd.upi_id} placeholder="name@bank" /></F>
            <F label="Payee name (shown in UPI apps)"><input name="payee_name" className="input" defaultValue={pd.payee_name} /></F>
            <F label="Account holder name"><input name="account_holder" className="input" defaultValue={pd.account_holder} /></F>
            <F label="Account number"><input name="account_number" className="input" inputMode="numeric" defaultValue={pd.account_number} /></F>
            <F label="IFSC"><input name="ifsc" className="input" defaultValue={pd.ifsc} style={{ textTransform: "uppercase" }} /></F>
            <F label="Bank name"><input name="bank_name" className="input" defaultValue={pd.bank_name} /></F>
            <F label="Branch" full><input name="branch" className="input" defaultValue={pd.branch} /></F>
            <F label="Payment instructions (optional)" full><textarea name="instructions" className="textarea" style={{ minHeight: 60 }} defaultValue={pd.instructions} placeholder="e.g. Please mention the invoice number in the payment note." /></F>
            <div className="form-actions full"><Submit>Save payment details</Submit></div>
          </ActionForm>
        </Panel>
        <Panel title="QR code preview" sub={pd.upi_id ? `Scan with any UPI app to check it opens a ₹${s.default_fee} payment to ${pd.payee_name}. Don't complete the payment.` : "Add a UPI ID to generate QR codes."}>
          {preview ? <div className="qr-box" dangerouslySetInnerHTML={{ __html: preview }} /> : <Badge tone="amber">No UPI ID yet</Badge>}
        </Panel>
      </div>

      <Panel title="Maintenance plan" id="plan" className="section">
        <ActionForm action={saveMaintenanceSettingsAction} className="form-grid" toast>
          <F label="Free period starts when"><select name="trigger" className="select" defaultValue={s.trigger}>
            <option value="proposal_initiated">The proposal/quotation is created (default)</option>
            <option value="proposal_accepted">The client accepts the proposal/quotation</option>
            <option value="project_delivered">The project is marked completed</option>
          </select></F>
          <F label="Free period (months)"><input name="free_months" type="number" min="1" max="60" className="input" defaultValue={s.free_months} required /></F>
          <F label="Default monthly fee (₹)" hint="Override per project on its maintenance page. Tax follows Pricing → Tax."><input name="default_fee" type="number" min="0" className="input" defaultValue={s.default_fee} required /></F>
          <F label="“Expiring soon” from (days before)"><input name="expiring_soon_days" type="number" min="1" max="120" className="input" defaultValue={s.expiring_soon_days} required /></F>
          <F label="Included services (one per line)" full><textarea name="included" className="textarea" defaultValue={s.included.join("\n")} /></F>
          <F label="Hosting & domain line" full hint="Only shown for projects where you tick “covers hosting & domain renewal”."><input name="hosting_line" className="input" defaultValue={s.hosting_line} /></F>
          <F label="Not included (one per line)" full><textarea name="excluded" className="textarea" defaultValue={s.excluded.join("\n")} /></F>
          <F label="Payment terms" full><textarea name="payment_terms" className="textarea" style={{ minHeight: 60 }} defaultValue={s.payment_terms} /></F>
          <F label="Cancellation terms" full><textarea name="cancellation_terms" className="textarea" style={{ minHeight: 60 }} defaultValue={s.cancellation_terms} /></F>
          <div className="form-actions full"><Submit>Save plan</Submit></div>
        </ActionForm>
      </Panel>

      <Panel title="Notifications" id="notify" className="section" sub="Messages are sent by the daily check at 9:00 AM India time. Each one is sent once, logged, and retried a limited number of times if it fails.">
        <ActionForm action={saveMaintenanceSettingsAction} className="form-grid" toast>
          <F label="Expiry reminders (days before)" hint="Comma-separated, e.g. 30, 7"><input name="reminder_days" className="input" defaultValue={s.reminder_days.join(", ")} /></F>
          <F label="Issue monthly invoice (days before billing date)"><input name="billing_reminder_days" type="number" min="0" max="30" className="input" defaultValue={s.billing_reminder_days} /></F>
          <F label="Catch-up window (days)" hint="If the check missed a day, reminders up to this many days late are still sent."><input name="catch_up_days" type="number" min="0" max="14" className="input" defaultValue={s.catch_up_days} /></F>
          <F label="Max attempts per message"><input name="retry_max_attempts" type="number" min="1" max="10" className="input" defaultValue={s.retry_max_attempts} /></F>
          <F label="Hours between retries"><input name="retry_delay_hours" type="number" min="0.25" step="0.25" max="168" className="input" defaultValue={s.retry_delay_hours} /></F>
          <F label="Admin alert email" hint="Defaults to the business email."><input name="admin_email" type="email" className="input" defaultValue={s.admin_email} /></F>
          <F label="Admin WhatsApp number" hint="With country code, e.g. 919876543210"><input name="admin_whatsapp" className="input" defaultValue={s.admin_whatsapp} /></F>
          <F label="WhatsApp template name" hint="An approved Cloud API template with one body variable {{1}}. Defaults to WHATSAPP_TEMPLATE_NAME."><input name="whatsapp_template" className="input" defaultValue={s.whatsapp_template} /></F>
          <F label="Template language code"><input name="whatsapp_language" className="input" defaultValue={s.whatsapp_language} /></F>
          <div className="form-actions full"><Submit>Save notification settings</Submit></div>
        </ActionForm>
      </Panel>

      <Panel title="Message templates" id="templates" className="section" sub={<>Placeholders: <span className="mono tiny">{PLACEHOLDERS}</span>. WhatsApp uses the body (line breaks become “ · ”).</>}>
        <div className="stack">{(Object.keys(NOTIFICATION_KINDS) as NotificationKind[]).map((k) => {
          const custom = s.templates?.[k];
          return (
            <details key={k}>
              <summary className="row" style={{ cursor: "pointer", gap: 8 }}><strong style={{ fontWeight: 500 }}>{NOTIFICATION_KINDS[k]}</strong>{custom && <Badge tone="blue">Customised</Badge>}</summary>
              <ActionForm action={saveTemplateAction.bind(null, k)} className="form-grid" toast>
                <F label="Subject" full><input name="subject" className="input" defaultValue={custom?.subject || DEFAULT_TEMPLATES[k].subject} /></F>
                <F label="Body" full><textarea name="body" className="textarea" style={{ minHeight: 160 }} defaultValue={custom?.body || DEFAULT_TEMPLATES[k].body} /></F>
                <div className="form-actions full row"><Submit>Save template</Submit>{custom && <Submit className="btn btn-ghost" name="reset" value="1">Reset to default</Submit>}</div>
              </ActionForm>
            </details>
          );
        })}</div>
      </Panel>
    </>
  );
}
