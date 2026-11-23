import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listShowcase } from "@/server/showcase";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { showcaseStatusAction, reviewTestimonialAction } from "@/app/actions/growth";
import { fmtDate } from "@/lib/format";
import { ShowcaseEditor } from "./editor";

export const metadata = { title: "Showcase & testimonials" };

export default async function AdminShowcase() {
  const actor = await requireAdmin();
  const s = await listShowcase(actor);
  return (
    <>
      <PageHead eyebrow="Growth" title="Showcase & testimonials" sub="Public pages at /showcase. Nothing is published without the client's recorded permission."
        actions={<><Link href="/showcase" className="btn" target="_blank">View public page</Link><ShowcaseEditor clients={s.clients} /></>} />
      <Panel title="Testimonials" sub="Clients submit these from their portal with consent to publish the exact text.">
        {s.testimonials.length === 0 ? <Empty icon="star" title="No testimonials yet" /> : (
          <div className="list">{s.testimonials.map((t) => (
            <div key={t.id} className="list-item" style={{ alignItems: "flex-start" }}>
              <div className="grow stack-sm">
                <p style={{ margin: 0 }}>&ldquo;{t.quote}&rdquo;</p>
                <span className="small faint">{t.display_name}{t.display_role ? `, ${t.display_role}` : ""} · {t.business_name} · {fmtDate(t.created_at)}{t.rating ? ` · ${t.rating}/5` : ""}</span>
              </div>
              <Badge tone={t.status === "published" ? "green" : t.status === "submitted" ? "amber" : ""} plain>{t.status}</Badge>
              {t.status === "submitted" && <><ActionButton action={reviewTestimonialAction.bind(null, t.id, "published")} className="btn btn-sm btn-success">Publish</ActionButton>
                <ActionButton action={reviewTestimonialAction.bind(null, t.id, "rejected")} className="btn btn-sm btn-ghost">Don&apos;t publish</ActionButton></>}
              {t.status === "published" && <ActionButton action={reviewTestimonialAction.bind(null, t.id, "submitted")} className="btn btn-sm btn-ghost">Unpublish</ActionButton>}
            </div>
          ))}</div>
        )}
      </Panel>
      <Panel title="Case studies" className="section">
        {s.items.length === 0 ? <Empty icon="star" title="No case studies yet">Add one, record the client's permission, then publish.</Empty> : (
          <div className="list">{s.items.map((i) => (
            <div key={i.id} className="list-item">
              <div className="grow"><div style={{ fontWeight: 500 }}>{i.title}</div>
                <div className="small faint">{i.client_label} · {i.industry} · {i.permission_confirmed_at ? `Permission recorded ${fmtDate(i.permission_confirmed_at)}` : "No permission recorded"}</div></div>
              <Badge tone={i.status === "published" ? "green" : ""} plain>{i.status}</Badge>
              <ShowcaseEditor item={i} clients={s.clients} />
              {i.status === "draft"
                ? <ActionButton action={showcaseStatusAction.bind(null, i.id, true)} className="btn btn-sm btn-primary">Publish</ActionButton>
                : <ActionButton action={showcaseStatusAction.bind(null, i.id, false)} className="btn btn-sm btn-ghost">Unpublish</ActionButton>}
            </div>
          ))}</div>
        )}
      </Panel>
    </>
  );
}
