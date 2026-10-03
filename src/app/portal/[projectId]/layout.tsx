import { notFound } from "next/navigation";
import { requireClient } from "@/lib/session";
import { ClientShell } from "@/components/client-shell";
import { clientProjects } from "@/server/dashboards";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const projects = await clientProjects(actor);
  if (!projects.some((p) => p.id === projectId)) notFound();
  return <ClientShell actor={actor} projectId={projectId}>{children}</ClientShell>;
}
