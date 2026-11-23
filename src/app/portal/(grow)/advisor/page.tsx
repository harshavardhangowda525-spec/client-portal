import Link from "next/link";
import { requireClient } from "@/lib/session";
import { getAdvisor } from "@/server/advisor";
import { Badge, PageHead, Panel } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ActionButton } from "@/components/forms";
import { advisorConsultationAction, deleteAdvisorAction } from "@/app/actions/growth";
import { AdvisorComposer } from "./composer";
import { ScrollToEnd } from "@/components/views/scroll-to-end";

export const metadata = { title: "AI service advisor" };
export const dynamic = "force-dynamic";

const STARTERS = ["I spend too much time answering appointment calls", "I want customers to book and pay online", "Billing and GST invoices take hours every week", "How do I get more customers from Google?"];

export default async function AdvisorPage() {
  const actor = await requireClient();
  const a = await getAdvisor(actor);
  const bySlug = new Map(a.services.map((s) => [s.slug, s]));
  const suggested = [...new Set(a.messages.flatMap((m) => m.services))].map((s) => bySlug.get(s)).filter(Boolean);
  return (
    <>
      <PageHead eyebrow="AI advisor" title="Find the right solution for your business"
        sub={a.aiOn ? "Describe a problem in your own words. The advisor only suggests services Infinity Web & Apps offers." : "Answer in your own words and we'll match you to our services."} />
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <section className="glass" aria-label="Conversation" style={{ display: "flex", flexDirection: "column", minHeight: 560 }}>
          <header className="row" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <span className="brand-mark" aria-hidden="true" style={{ color: "#fff" }}><Icon name="sparkle" /></span>
            <div className="grow" style={{ flex: 1 }}><strong>Service advisor</strong><div className="tiny faint">{a.aiOn ? "AI-assisted · suggestions only, never prices or deadlines" : "Guided matching (AI is switched off)"}</div></div>
            <Badge tone={a.aiOn ? "green" : ""} plain>{a.aiOn ? "AI on" : "Guided"}</Badge>
          </header>
          <p role="note" className="tiny muted" style={{ margin: "12px 18px 0", padding: "8px 12px", borderRadius: 10, background: "var(--panel-strong)" }}>
            Your chat is kept for {a.retentionDays} days so our team can follow up, then deleted. Please don&apos;t share patient, customer or payment details.
          </p>
          <div className="chat" style={{ flex: 1, padding: 18, maxHeight: "none" }}>
            {a.messages.length === 0 && (
              <div className="advisor-ai">Hi {actor.name.split(" ")[0]}! What would you like to improve in your business? Pick an example below or type your own.</div>
            )}
            {a.messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "advisor-me" : "advisor-ai"}>
                {m.content}
                {m.role === "assistant" && m.services.length > 0 && (
                  <div className="row" style={{ marginTop: 10 }}>{m.services.map((s) => bySlug.get(s) && <Badge key={s} tone="violet" plain>{bySlug.get(s)!.name}</Badge>)}</div>
                )}
              </div>
            ))}
            <ScrollToEnd />
          </div>
          <AdvisorComposer starters={a.messages.length === 0 ? STARTERS : []} />
        </section>
        <div className="stack">
          <Panel title="From this conversation">
            {suggested.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Services the advisor suggests will collect here.</p> : (
              <div className="stack-sm">
                {suggested.map((s) => <div key={s!.id} className="row-between"><span>{s!.name}</span><span className="tiny faint">{s!.price_label ?? "Quote on request"}</span></div>)}
              </div>
            )}
            <hr />
            {a.conversation?.consultation_requested_at
              ? <div className="notice success small">Sent to our team. We&apos;ll contact you within one working day.</div>
              : <ActionButton action={advisorConsultationAction} className="btn btn-primary btn-block">Request a consultation</ActionButton>}
            <p className="tiny faint" style={{ margin: "8px 0 0" }}>Creates a request for our team. Nothing is charged.</p>
          </Panel>
          <Panel title="Prefer a person?">
            <div className="stack-sm">
              <Link href="/portal/meetings" className="btn"><Icon name="calendar" /> Book a 15-minute call</Link>
              <Link href="/portal/services" className="btn btn-ghost"><Icon name="store" /> Browse all services</Link>
            </div>
          </Panel>
          {a.messages.length > 0 && <ActionButton action={deleteAdvisorAction} className="btn btn-sm btn-ghost" confirm="Delete your advisor chat history?"><Icon name="trash" /> Delete my chat history</ActionButton>}
        </div>
      </div>
    </>
  );
}
