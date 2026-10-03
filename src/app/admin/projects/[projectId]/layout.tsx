import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { projectOverview } from "@/server/dashboards";
import { unreadMessageCount } from "@/server/content";
import { Badge, ProjectBadge } from "@/components/ui";
import { ProjectTabs } from "./tabs";
import { AppError } from "@/lib/errors";
import { PROJECT_TYPES } from "@/lib/format";

export default async function AdminProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  let o: Awaited<ReturnType<typeof projectOverview>>;
  try { o = await projectOverview(actor, projectId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const unread = await unreadMessageCount(actor, projectId);
  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <span className="eyebrow"><Link href={`/admin/clients/${o.project.client_id}`}>{o.client.business_name}</Link> · {PROJECT_TYPES[o.project.project_type]}</span>
          <h1>{o.project.name} {o.project.is_sample && <Badge plain>Sample</Badge>}</h1>
          <div className="row" style={{ marginTop: 6 }}><ProjectBadge status={o.project.status} /><span className="small muted">{o.progress}% complete · {o.project.current_stage ?? "—"}</span></div>
        </div>
      </div>
      <ProjectTabs projectId={projectId} unread={unread} />
      {children}
    </>
  );
}
