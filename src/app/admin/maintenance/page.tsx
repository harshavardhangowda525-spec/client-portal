import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { lastJobRun, listMaintenance, getPaymentDetails, integrationStatus, fmtIST, type MaintenanceFilter } from "@/server/maintenance";
import { Badge, DeliveryBadge, Empty, MaintenanceBadge, Money, PageHead, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { runMaintenanceCheckAction } from "@/app/actions/maintenance";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

const FILTERS: [MaintenanceFilter, string][] = [
  ["all", "All"], ["free", "Free maintenance"], ["expiring30", "Expiring in 30 days"], ["expiring7", "Expiring in 7 days"],
  ["expired", "Expired"], ["paid", "Paid active"], ["overdue", "Payment overdue"],
];

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const actor = await requireAdmin();
  const f = ((await searchParams).f ?? "all") as MaintenanceFilter;
  const filter = FILTERS.some(([k]) => k === f) ? f : "all";
  const [{ rows, stats, settings }, job, pd] = await Promise.all([listMaintenance(actor, filter), lastJobRun(), getPaymentDetails()]);
  const st = integrationStatus();
  const waTemplate = !!(settings.whatsapp_template || process.env.WHATSAPP_TEMPLATE_NAME);
  const warnings = [
    !st.email && "Email (SMTP) is not configured, so maintenance emails are logged as “not configured” and not sent.",
    !(st.whatsapp && waTemplate) && "WhatsApp Cloud API is not configured (token, phone number ID and an approved template), so WhatsApp messages are not sent.",
    !st.cron && "CRON_SECRET is not set, so the daily automatic check cannot run. Use “Run check now” until it is set.",
    !pd.upi_id && !pd.account_number && "Payment details are missing, so clients have no UPI QR code or bank details to pay maintenance invoices.",
    !settings.admin_email && "No admin alert email is set in maintenance settings; alerts go to the business email instead.",
  ].filter(Boolean) as string[];
  return (
    <>
      <PageHead title="Maintenance" sub={`Free maintenance lasts ${settings.free_months} months from when the ${settings.trigger.replace("_", " ")}. Afterwards clients can opt in to paid maintenance (default ₹${settings.default_fee}/month).`}
        actions={<>
          <a className="btn" href="/api/admin/maintenance/export"><Icon name="download" /> Export CSV</a>
          <Link className="btn" href="/admin/settings/maintenance"><Icon name="settings" /> Settings</Link>
          <ActionButton action={runMaintenanceCheckAction} className="btn btn-primary">Run check now</ActionButton>
        </>} />

      {warnings.length > 0 && (
        <div className="notice warn section" style={{ marginTop: 0 }}>
          <strong>Setup needed</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{warnings.map((w) => <li key={w} className="small">{w}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-4 section" style={{ marginTop: 0 }}>
        {([["free", "Free maintenance"], ["expiring30", "Expiring ≤ 30 days"], ["paid", "Paid active"], ["overdue", "Payment overdue"]] as const).map(([k, l]) => (
          <Link key={k} href={`/admin/maintenance?f=${k}`} className="panel" style={{ display: "block" }}>
            <span className="tiny faint">{l}</span><div className="stat-value" style={k === "overdue" && stats.overdue ? { color: "var(--red)" } : undefined}>{stats[k]}</div>
          </Link>
        ))}
      </div>

      <nav className="tabs" aria-label="Filter">
        {FILTERS.map(([k, l]) => <Link key={k} href={k === "all" ? "/admin/maintenance" : `/admin/maintenance?f=${k}`} aria-current={k === filter ? "page" : undefined}>{l}{k !== "all" ? ` (${stats[k]})` : ""}</Link>)}
      </nav>

      <Panel>
        {rows.length === 0 ? <Empty icon="wrench" title="Nothing here">Projects appear once a proposal is created for them.</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Client / project</th><th>Proposal initiated</th><th>Free period</th><th className="num">Days left</th><th className="num">Fee</th><th>Status</th><th>Email</th><th>WhatsApp</th><th>Next billing</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Client"><Link href={`/admin/maintenance/${r.id}`} style={{ fontWeight: 500 }}>{r.business_name}</Link><div className="tiny faint">{r.name}</div></td>
                <td data-label="Initiated" className="small">{r.proposal_started_at ? fmtDateTime(r.proposal_started_at) : "—"}</td>
                <td data-label="Free period" className="small">{r.free_maintenance_start_date ? <>{fmtIST(r.free_maintenance_start_date)} →<br />{fmtIST(r.free_maintenance_end_date)}</> : "—"}{r.maintenance_dates_overridden && <div className="tiny faint">Set manually</div>}</td>
                <td data-label="Days left" className="num">{r.days_left == null ? "—" : r.days_left < 0 ? <span className="faint">ended</span> : r.days_left}</td>
                <td data-label="Fee" className="num"><Money value={r.fee} /></td>
                <td data-label="Status"><MaintenanceBadge status={r.maintenance_status} />{r.maintenance_exempt && <Badge plain>Exempt</Badge>}{r.maintenance_paused && <Badge plain>Paused</Badge>}</td>
                <td data-label="Email"><DeliveryBadge status={r.email_status} /></td>
                <td data-label="WhatsApp"><DeliveryBadge status={r.whatsapp_status} /></td>
                <td data-label="Next billing" className="small">{fmtIST(r.next_billing_date)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="tiny faint section">
        {job ? <>Last check: {fmtDateTime(job.last_run_at)} ({job.trigger}) · {job.projects} projects · {job.invoices} invoices issued{job.errors?.length ? ` · ${job.errors.length} problem(s)` : ""}</> : "The daily check has not run yet."}
        {" "}Dates are in India time (IST).
      </p>
    </>
  );
}
