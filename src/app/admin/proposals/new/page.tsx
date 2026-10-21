import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getCatalog } from "@/server/pricing";
import { listAdmins, listClients, getProjectSummary } from "@/server/clients";
import { PageHead } from "@/components/ui";
import { ProposalWizard } from "../wizard";
import { newWizardState } from "../wizard-state";

export const metadata = { title: "New proposal" };
export const dynamic = "force-dynamic";

const PROJECT_TO_PROPOSAL: Record<string, string> = { website: "website", mobile_app: "cross_platform_app", web_app: "website_app" };

export default async function NewProposal({ searchParams }: { searchParams: Promise<{ client?: string; id?: string; project?: string }> }) {
  const actor = await requireAdmin();
  const { id, project } = await searchParams;
  let { client } = await searchParams;
  const forProject = project && /^[0-9a-f-]{36}$/i.test(project) ? await getProjectSummary(actor, project).catch(() => null) : null;
  if (forProject) client = forProject.client_id;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) redirect(`/admin/proposals/${id}/edit`);
  const [catalog, clients, admins] = await Promise.all([getCatalog(actor), listClients(actor), listAdmins(actor)]);
  const initial = newWizardState(catalog, actor.userId);
  const pre = clients.find((c) => c.id === client);
  if (pre) {
    initial.client = { mode: "existing", client_id: pre.id };
    initial.contact = { name: pre.owner_name, email: pre.email, phone: pre.phone };
    initial.business_category = pre.business_category;
    if (forProject) {
      initial.project_id = forProject.id;
      initial.title = forProject.name;
      initial.project_type = PROJECT_TO_PROPOSAL[forProject.project_type] ?? "website";
      initial.description = forProject.description;
    }
  } else if (clients.length === 0) {
    initial.client = { mode: "new", business_name: "", owner_name: "", email: "", phone: null, business_category: null };
  }
  return (
    <>
      <PageHead eyebrow="Proposals" title="New proposal"
        sub={forProject ? `For project “${forProject.name}”. Once the client accepts, it becomes the project's price and payment schedule.` : "Work through the steps — every save is recalculated on the server."} />
      <ProposalWizard catalog={catalog} clients={clients} admins={admins} initial={initial} proposalId={null} />
    </>
  );
}
