import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { maintenanceDetail, fmtIST, NOTIFICATION_KINDS, type NotificationKind } from "@/server/maintenance";
import { Badge, DeliveryBadge, Empty, InvoiceBadge, MaintenanceBadge, Money, PageHead, Panel, PaymentBadge } from "@/components/ui";
import { ActionButton, ActionForm, Submit } from "@/components/forms";
import { adminCancelMaintenanceAction, resendNotificationAction, retryDeliveriesAction, updateProjectMaintenanceAction } from "@/app/actions/maintenance";
import { setPaymentStatusAction } from "@/app/actions/admin";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

export default async function MaintenanceDetail({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const d = await maintenanceDetail(actor, projectId);
  const p = d.project;
  const active = !!p.maintenance_activated_at && !p.maintenance_cancelled_at;
  return (
    <>
      <PageHead eyebrow={<Link href="/admin/maintenance">Maintenance</Link>} title={`${d.client.business_name} — ${p.name}`}
        sub={<>{d.client.owner_name} · {d.client.email}{d.client.phone ? ` · ${d.client.phone}` : ""}</>}
        actions={<Link className="btn" href={`/admin/projects/${projectId}/billing`}>Project billing →</Link>} />

      <div className="grid grid-4">
        <div className="panel"><span className="tiny faint">Status</span><div style={{ marginTop: 6 }}><MaintenanceBadge status={p.maintenance_status} /> {p.maintenance_exempt && <Badge plain>Exempt</Badge>} {p.maintenance_paused && <Badge plain>Paused</Badge>}</div></div>
        <div className="panel"><span className="tiny faint">Free period ends</span><div className="stat-value" style={{ fontSize: "1.1rem" }}>{fmtIST(p.free_maintenance_end_date)}</div>
          <span className="tiny faint">{p.days_left == null ? "Not started — no proposal yet" : p.days_left > 0 ? `${p.days_left} day(s) left` : p.days_left === 0 ? "Ended today" : `Ended ${-p.days_left} day(s) ago`}</span></div>
        <div className="panel"><span className="tiny faint">Monthly fee</span><div className="stat-value"><Money value={p.fee} /></div><span className="tiny faint">{p.monthly_maintenance_fee == null ? "Default from settings" : "Custom for this project"}</span></div>
        <div className="panel"><span className="tiny faint">Next billing date</span><div className="stat-value" style={{ fontSize: "1.1rem" }}>{fmtIST(p.next_billing_date)}</div>
          <span className="tiny faint">{active ? `Activated ${fmtDateTime(p.maintenance_activated_at)}` : p.maintenance_cancelled_at ? `Cancelled ${fmtDateTime(p.maintenance_cancelled_at)}` : "Client has not opted in"}</span></div>
      </div>

      <div className="grid grid-2 section" style={{ alignItems: "start" }}>
        <Panel title="Controls" sub="Every change is recorded in the history below.">
          <ActionForm action={updateProjectMaintenanceAction.bind(null, projectId)} className="form-grid" toast>
            <label className="field"><span className="label">Free maintenance start</span><input type="date" name="free_maintenance_start_date" className="input" defaultValue={p.free_maintenance_start_date ?? ""} /></label>
            <label className="field"><span className="label">Free maintenance expiry</span><input type="date" name="free_maintenance_end_date" className="input" defaultValue={p.free_maintenance_end_date ?? ""} />
              <span className="hint">Changing only the start recalculates the expiry.</span></label>
            <label className="field"><span className="label">Monthly fee (₹)</span><input type="number" name="monthly_maintenance_fee" min="0" step="1" className="input" defaultValue={p.monthly_maintenance_fee ?? ""} placeholder={`Default (${p.fee})`} />
              {active && <span className="hint">Applies to invoices not yet issued.</span>}</label>
            <label className="field"><span className="label">Note for the history (optional)</span><input name="note" className="input" maxLength={1000} /></label>
            <label className="check full"><input type="checkbox" name="maintenance_exempt" defaultChecked={p.maintenance_exempt} /> Exempt — no maintenance notices or charges for this project</label>
            <label className="check full"><input type="checkbox" name="maintenance_paused" defaultChecked={p.maintenance_paused} /> Pause — stop notices and new invoices for now</label>
            <label className="check full"><input type="checkbox" name="maintenance_covers_hosting" defaultChecked={p.maintenance_covers_hosting} /> Maintenance agreement covers hosting &amp; domain renewal (shown to the client only when ticked)</label>
            {p.maintenance_dates_overridden && <label className="check full"><input type="checkbox" name="reset_dates" /> Reset dates to automatic (from the proposal)</label>}
            <div className="form-actions full"><Submit>Save changes</Submit></div>
          </ActionForm>
        </Panel>

        <div className="stack">
          <Panel title="Send a notification now" sub="Sends again even if it already went out. Logged with the result.">
            <ActionForm action={resendNotificationAction.bind(null, projectId)} className="row" toast>
              <select name="kind" className="select" style={{ flex: 1 }} aria-label="Notification">
                <option value="expiry_reminder">Free maintenance ending soon</option>
                <option value="expired">Free maintenance has ended</option>
                <option value="billing_reminder">Monthly billing reminder</option>
                <option value="payment_overdue">Payment overdue</option>
              </select>
              <Submit className="btn">Send</Submit>
            </ActionForm>
          </Panel>
          {active && (
            <Panel title="Paid maintenance">
              <p className="small muted">Cancelling stops future monthly invoices and voids unpaid invoices that are not yet due. Invoices already due stay payable.</p>
              <ActionButton action={adminCancelMaintenanceAction.bind(null, projectId)} className="btn btn-danger btn-sm" confirm="Cancel paid maintenance for this project?">Cancel paid maintenance</ActionButton>
            </Panel>
          )}
          {d.consents.length > 0 && (
            <Panel title="Client consent">
              <div className="list">{d.consents.map((c) => (
                <div key={c.id} className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>{c.signer_name}</strong>
                  <div className="tiny faint">{fmtDateTime(c.created_at)} · <Money value={Number(c.monthly_total)} />/month · billing from {fmtIST(c.billing_start)}</div></div></div>
              ))}</div>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Maintenance invoices & payments" className="section">
        {d.invoices.length === 0 ? <Empty icon="receipt" title="No maintenance invoices">Invoices are issued automatically each month only after the client activates paid maintenance.</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Invoice</th><th>Period</th><th>Due</th><th className="num">Amount</th><th>Status</th><th>Payments</th></tr></thead>
            <tbody>{d.invoices.map((i) => (
              <tr key={i.id}>
                <td data-label="Invoice"><a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener" style={{ fontWeight: 500 }}>{i.number}</a></td>
                <td data-label="Period" className="small">{fmtIST(i.billing_period_start)} – {fmtIST(i.billing_period_end)}</td>
                <td data-label="Due" className="small">{fmtIST(i.due_date)}</td>
                <td data-label="Amount" className="num"><Money value={Number(i.amount)} /></td>
                <td data-label="Status"><InvoiceBadge status={i.status} overdue={["issued", "partially_paid"].includes(i.status) && !!i.due_date && i.due_date < d.today} /></td>
                <td data-label="Payments">{d.payments.filter((x) => x.invoice_id === i.id).map((x) => (
                  <div key={x.id} className="row small" style={{ gap: 6, marginBottom: 4 }}>
                    <PaymentBadge status={x.status} /> <Money value={Number(x.amount)} /> <span className="faint">{x.reference ?? ""}{x.reported_by ? " · reported by client" : ""}</span>
                    {x.status === "pending" && <>
                      <ActionButton action={setPaymentStatusAction.bind(null, x.id, "confirmed")} className="btn btn-sm btn-primary" confirm="Confirm you have received this payment in your bank/UPI account?">Confirm</ActionButton>
                      <ActionButton action={setPaymentStatusAction.bind(null, x.id, "failed")} className="btn btn-sm" confirm="Mark this payment as not received?">Not received</ActionButton>
                    </>}
                    {x.receipt_number && <a className="tiny" href={`/api/payments/${x.id}/receipt`} target="_blank" rel="noopener">{x.receipt_number}</a>}
                  </div>
                ))}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Message delivery log" className="section" actions={<ActionButton action={retryDeliveriesAction.bind(null, projectId, undefined)} className="btn btn-sm">Retry failed</ActionButton>}>
        {d.deliveries.length === 0 ? <p className="small muted">No maintenance emails or WhatsApp messages yet.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Message</th><th>Channel</th><th>To</th><th>Result</th><th>Attempts</th></tr></thead>
            <tbody>{d.deliveries.map((m) => (
              <tr key={m.id}>
                <td className="small">{fmtDateTime(m.created_at)}</td>
                <td className="small">{NOTIFICATION_KINDS[m.kind as NotificationKind] ?? m.kind}</td>
                <td className="small">{m.channel}</td><td className="small">{m.recipient}</td>
                <td><DeliveryBadge status={m.status} />{m.error && <div className="tiny faint">{m.error}</div>}{m.next_retry_at && m.status === "failed" && <div className="tiny faint">Retry after {fmtDateTime(m.next_retry_at)}</div>}</td>
                <td className="small">{m.attempts}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="History" className="section">
        {d.history.length === 0 ? <p className="small muted">No changes yet.</p> : (
          <div className="list">{d.history.map((h) => (
            <div key={h.id} className="list-item"><div className="grow">
              <strong style={{ fontWeight: 500 }}>{h.action.replace(/[._]/g, " ")}</strong>
              <div className="tiny faint">{fmtDateTime(h.created_at)} · {h.actor_name ?? (h.actor_role ?? "system")}</div>
              {h.data && Object.keys(h.data).length > 0 && <div className="tiny faint mono" style={{ wordBreak: "break-word" }}>{JSON.stringify(h.data).slice(0, 400)}</div>}
            </div></div>
          ))}</div>
        )}
      </Panel>
    </>
  );
}
