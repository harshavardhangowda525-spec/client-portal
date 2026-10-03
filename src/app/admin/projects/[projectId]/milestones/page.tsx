import { requireAdmin } from "@/lib/session";
import { listMilestones } from "@/server/milestones";
import { computeProgress } from "@/lib/progress";
import { Empty, Panel, ProgressBar } from "@/components/ui";
import { Timeline } from "@/components/views/timeline";
import { UploadForm } from "@/components/views/upload-form";
import { MilestoneControls, NewMilestoneForm } from "./controls";

export const dynamic = "force-dynamic";

export default async function MilestonesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const ms = await listMilestones(actor, projectId);
  const totalWeight = ms.reduce((s, m) => s + Number(m.weight), 0);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        <Panel title="Milestones" sub={`Progress = completed weight ÷ total weight (${totalWeight}). Only you can change development status.`}>
          <div className="row" style={{ gap: 10, marginBottom: 18 }}><div style={{ flex: 1 }}><ProgressBar value={computeProgress(ms)} /></div><strong className="mono small">{computeProgress(ms)}%</strong></div>
          {ms.length === 0 ? <Empty icon="timeline" title="No milestones">Add the steps for this project on the right.</Empty> :
            <Timeline milestones={ms} showWeights renderActions={(m) => <MilestoneControls milestone={m as never} first={m.id === ms[0].id} last={m.id === ms[ms.length - 1].id} />} />}
        </Panel>
      </div>
      <div className="stack" style={{ position: "sticky", top: 80 }}>
        <Panel title="Add milestone"><NewMilestoneForm projectId={projectId} /></Panel>
        <Panel title="Attach a file to a milestone" sub="Screenshots or documents shown on the client timeline.">
          <UploadForm projectId={projectId} categories={[["screenshot", "Screenshot"], ["requirements", "Requirements"], ["handover", "Handover"], ["other", "Other"]]}
            extra={<div className="field full"><label htmlFor="ms-att">Milestone</label><select id="ms-att" name="milestone_id" className="select" required>{ms.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
              <input type="hidden" name="visibility" value="client" /></div>} />
        </Panel>
      </div>
    </div>
  );
}
