import { redirect } from "next/navigation";
import Link from "next/link";
import { requireClient } from "@/lib/session";
import { clientProjects } from "@/server/dashboards";
import { listClientProposals } from "@/server/proposals";
import { Money, ProposalBadge } from "@/components/ui";
import { ClientShell } from "@/components/client-shell";
import { Empty, PageHead, ProjectBadge } from "@/components/ui";
import { PROJECT_TYPES } from "@/lib/format";

export const metadata = { title: "Your projects" };

export default async function PortalHome() {
  const actor = await requireClient();
  const [projects, proposals] = await Promise.all([clientProjects(actor), listClientProposals(actor)]);
  const awaiting = proposals.filter((p) => ["sent", "viewed"].includes(p.status));
  if (projects.length === 1 && awaiting.length === 0) redirect(`/portal/${projects[0].id}`);
  return (
    <ClientShell actor={actor}>
      <PageHead title={`Welcome, ${actor.name.split(" ")[0]}`} sub={projects.length ? "Choose a project to continue." : "Your proposals from Infinity Web & Apps."} />
      {awaiting.length > 0 && (
        <section className="glass panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h2>Proposals awaiting your review</h2></div>
          <div className="list">
            {awaiting.map((p) => (
              <Link key={p.id} href={`/portal/proposals/${p.id}`} className="list-item">
                <div className="grow"><div style={{ fontWeight: 500 }}>{p.title}</div><div className="small faint">{p.number} · valid until {p.valid_until}</div></div>
                <Money value={p.total} /><ProposalBadge status={p.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="glass panel">
        {projects.length === 0 ? (
          <Empty icon="briefcase" title="No projects yet" action={proposals.length ? <Link className="btn" href="/portal/proposals">View your proposals</Link> : undefined}>Your project will appear here once work is confirmed.</Empty>
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
