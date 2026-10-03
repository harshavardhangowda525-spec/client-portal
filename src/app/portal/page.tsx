import { redirect } from "next/navigation";
import Link from "next/link";
import { requireClient } from "@/lib/session";
import { clientProjects } from "@/server/dashboards";
import { ClientShell } from "@/components/client-shell";
import { Empty, PageHead, ProjectBadge } from "@/components/ui";
import { PROJECT_TYPES } from "@/lib/format";

export const metadata = { title: "Your projects" };

export default async function PortalHome() {
  const actor = await requireClient();
  const projects = await clientProjects(actor);
  if (projects.length === 1) redirect(`/portal/${projects[0].id}`);
  return (
    <ClientShell actor={actor}>
      <PageHead title={`Welcome, ${actor.name.split(" ")[0]}`} sub="Choose a project to continue." />
      <div className="glass panel">
        {projects.length === 0 ? (
          <Empty icon="briefcase" title="No projects yet">Your project will appear here as soon as Infinity Web &amp; Apps adds you to it.</Empty>
        ) : (
          <div className="list">
            {projects.map((p) => (
              <Link key={p.id} href={`/portal/${p.id}`} className="list-item">
                <div className="grow"><div style={{ fontWeight: 500 }}>{p.name}</div><div className="small faint">{PROJECT_TYPES[p.project_type]}</div></div>
                <ProjectBadge status={p.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </ClientShell>
  );
}
