import { requireClient } from "@/lib/session";
import { listMilestones } from "@/server/milestones";
import { computeProgress } from "@/lib/progress";
import { Empty, PageHead, Panel, ProgressBar } from "@/components/ui";
import { Timeline } from "@/components/views/timeline";

export const metadata = { title: "Timeline" };

export default async function TimelinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const ms = await listMilestones(actor, projectId);
  const progress = computeProgress(ms);
  const done = ms.filter((m) => m.status === "completed").length;
  return (
    <>
      <PageHead eyebrow="Project timeline" title="Milestones" sub="Every step of your project, from kick-off to handover." />
      <Panel>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="small muted">{done} of {ms.length} milestones completed</span>
          <strong className="mono">{progress}%</strong>
        </div>
        <ProgressBar value={progress} label="Overall progress" />
        <p className="tiny faint" style={{ marginTop: 8 }}>Progress is calculated from completed milestones, weighted by the amount of work in each.</p>
      </Panel>
      <div className="glass panel section">
        {ms.length ? <Timeline milestones={ms} /> : <Empty icon="timeline" title="Timeline coming soon">Your milestones will appear here once the project plan is ready.</Empty>}
      </div>
    </>
  );
}
