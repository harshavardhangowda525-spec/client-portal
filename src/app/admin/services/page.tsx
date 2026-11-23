import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listServices, listInquiries, INQUIRY_STATUSES, SERVICE_CATEGORIES } from "@/server/marketplace";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { ServiceEditor, InquiryStatus } from "./editors";

export const metadata = { title: "Services & upgrade requests" };

export default async function AdminServices() {
  const actor = await requireAdmin();
  const [services, inquiries] = await Promise.all([listServices(actor, { includeInactive: true }), listInquiries(actor)]);
  return (
    <>
      <PageHead eyebrow="Growth" title="Services & upgrade requests" sub="The catalogue clients see under Services, and every upgrade they ask for. Each request is also an opportunity in the pipeline."
        actions={<ServiceEditor />} />
      <Panel title="Upgrade requests" sub="Newest first">
        {inquiries.length === 0 ? <Empty icon="inbox" title="No requests yet">When a client taps “Request upgrade”, it appears here.</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Client</th><th>Service</th><th>Note</th><th>Requested</th><th>Pipeline</th><th>Status</th></tr></thead>
            <tbody>
              {inquiries.map((q) => (
                <tr key={q.id}>
                  <td data-label="Client">{q.business_name}</td>
                  <td data-label="Service">{q.service_name}{q.source === "ai_advisor" ? <> <Badge tone="violet" plain>AI advisor</Badge></> : null}</td>
                  <td data-label="Note" className="small muted">{q.note ?? "—"}</td>
                  <td data-label="Requested">{fmtDate(q.created_at)}</td>
                  <td data-label="Pipeline">{q.lead_id ? <Link href={`/admin/referrals/leads/${q.lead_id}`}>{q.lead_stage?.replace(/_/g, " ") ?? "Open"}</Link> : "—"}</td>
                  <td data-label="Status"><InquiryStatus id={q.id} status={q.status} options={INQUIRY_STATUSES} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
      <Panel title="Service catalogue" className="section" sub="Inactive services are hidden from clients. Prices left blank show as “Quote on request”.">
        <div className="table-wrap"><table className="table table-cards">
          <thead><tr><th>Service</th><th>Category</th><th>Price shown</th><th>Recommended for</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td data-label="Service"><strong style={{ fontWeight: 500 }}>{s.name}</strong><div className="tiny faint">{s.summary}</div></td>
                <td data-label="Category">{SERVICE_CATEGORIES[s.category]}</td>
                <td data-label="Price">{s.price_label ?? "Quote on request"}</td>
                <td data-label="Industries" className="small muted">{s.industries.join(", ") || "—"}</td>
                <td data-label="Status">{s.is_active ? <Badge tone="green" plain>Active</Badge> : <Badge plain>Hidden</Badge>}</td>
                <td data-label=""><ServiceEditor service={s} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}
