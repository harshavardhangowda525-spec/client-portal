import Link from "next/link";
import { requireClient } from "@/lib/session";
import { getFeedbackRequest } from "@/server/referrals";
import { PageHead, Panel } from "@/components/ui";
import { FeedbackForm } from "./form";

export const metadata = { title: "Your feedback" };

export default async function Feedback({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const { workflow, feedback } = await getFeedbackRequest(actor, projectId);
  return (
    <>
      <PageHead eyebrow="Feedback" title="Your project is complete!" sub="We'd love to hear about your experience with Infinity Web & Apps." />
      {feedback ? (
        <Panel>
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>Thank you for your feedback!</h2>
          {feedback.sentiment === "high" ? (
            <div className="stack-sm"><p className="muted" style={{ margin: 0 }}>Enjoyed working with us? Know another business that could benefit from better technology? We&apos;d appreciate an introduction.</p>
              <div className="row"><Link href="/portal/referrals" className="btn btn-primary">Refer a business</Link><Link href={`/portal/${projectId}`} className="btn btn-ghost">Maybe later</Link></div></div>
          ) : <p className="muted" style={{ margin: 0 }}>Thank you for being honest with us. Our team will review your feedback and get in touch to put things right.</p>}
        </Panel>
      ) : !workflow || !["awaiting_feedback", "feedback_received"].includes(workflow.status) ? (
        <Panel><p className="muted" style={{ margin: 0 }}>Feedback opens once your project is marked complete.</p></Panel>
      ) : (
        <Panel title="How did we do?"><FeedbackForm projectId={projectId} /></Panel>
      )}
    </>
  );
}
