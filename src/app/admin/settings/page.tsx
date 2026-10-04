import { requireAdmin } from "@/lib/session";
import { databaseSecurityStatus, deliveryLog } from "@/server/dashboards";
import { Badge, PageHead, Panel } from "@/components/ui";
import { PasswordForm } from "@/components/views/password-form";
import { integrations, appUrl, company } from "@/lib/config";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function Status({ ok, on = "Connected", off = "Not configured" }: { ok: boolean; on?: string; off?: string }) {
  return <Badge tone={ok ? "green" : "amber"}>{ok ? on : off}</Badge>;
}

export default async function SettingsPage() {
  const actor = await requireAdmin();
  const [sec, log] = await Promise.all([databaseSecurityStatus(actor), deliveryLog(actor)]);
  const i = integrations();
  return (
    <>
      <PageHead title="Settings" sub="Integrations, security status and your account."
        actions={<a href="/admin/settings/pricing" className="btn">Pricing configuration →</a>} />
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Panel title="Integrations" sub="Configured with environment variables on the server. Nothing is reported as delivered unless the provider accepted it.">
          <div className="list">
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Email (SMTP)</strong><div className="tiny faint">Invitations and quotation emails. Without it, copy links and share them manually.</div></div><Status ok={i.email} /></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>WhatsApp Cloud API</strong><div className="tiny faint">Automated WhatsApp messages. Without it, use “Open in WhatsApp” to send a pre-filled chat yourself.</div></div><Status ok={i.whatsapp} /></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Razorpay</strong><div className="tiny faint">Online invoice payments, verified server-side.</div></div><Status ok={i.razorpay} /></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Razorpay webhook</strong><div className="tiny faint">Endpoint: {appUrl()}/api/razorpay/webhook</div></div><Status ok={i.razorpayWebhook} /></div>
          </div>
        </Panel>
        <Panel title="Security">
          <div className="list">
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Row Level Security enforced</strong><div className="tiny faint">The database role must not be a superuser or have BYPASSRLS.</div></div><Status ok={sec.rlsEnforced} on="Enforced" off="NOT enforced" /></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Tables with forced RLS</strong></div><span className="mono small">{sec.tablesForced} / {sec.tablesTotal}</span></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Secure cookies</strong><div className="tiny faint">Set COOKIE_SECURE=true when serving over HTTPS.</div></div><Status ok={process.env.COOKIE_SECURE === "true"} on="On" off="Off" /></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Browser setup page</strong><div className="tiny faint">Remove ADMIN_SETUP_TOKEN after creating the first admin.</div></div><Status ok={!process.env.ADMIN_SETUP_TOKEN} on="Disabled" off="Token still set" /></div>
            <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Sample data</strong><div className="tiny faint">Remove before go-live: <code>npm run sample:remove</code></div></div>{sec.sampleClients ? <Badge tone="amber">{sec.sampleClients} sample client(s)</Badge> : <Badge tone="green">None</Badge>}</div>
          </div>
        </Panel>
        <Panel title="Company details" sub="Printed on quotations, invoices and receipts (COMPANY_* variables).">
          <dl className="kv"><div><dt>Name</dt><dd>{company().name}</dd></div><div><dt>Email</dt><dd>{company().email || "—"}</dd></div><div><dt>Phone</dt><dd>{company().phone || "—"}</dd></div><div><dt>Tax ID</dt><dd>{company().taxId || "—"}</dd></div></dl>
        </Panel>
        <Panel title="Change your password"><PasswordForm /></Panel>
      </div>
      <Panel title="Recent message deliveries" className="section">
        {log.length === 0 ? <p className="small muted">No emails or WhatsApp messages attempted yet.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Purpose</th><th>Result</th></tr></thead>
            <tbody>{log.map((l) => (
              <tr key={l.id}><td className="small">{fmtDateTime(l.created_at)}</td><td>{l.channel}</td><td className="small">{l.recipient}</td><td className="small">{l.purpose}</td>
                <td><Badge tone={l.status === "sent" ? "green" : l.status === "failed" ? "red" : "amber"}>{l.status.replace("_", " ")}</Badge>{l.error && <div className="tiny faint">{l.error}</div>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
