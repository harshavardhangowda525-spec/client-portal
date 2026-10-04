import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getCatalog } from "@/server/pricing";
import { listAdmins, listClients } from "@/server/clients";
import { PageHead } from "@/components/ui";
import { ProposalWizard } from "../wizard";
import { newWizardState } from "../wizard-state";

export const metadata = { title: "New proposal" };
export const dynamic = "force-dynamic";

export default async function NewProposal({ searchParams }: { searchParams: Promise<{ client?: string; id?: string }> }) {
  const actor = await requireAdmin();
  const { client, id } = await searchParams;
  if (id && /^[0-9a-f-]{36}$/i.test(id)) redirect(`/admin/proposals/${id}/edit`);
  const [catalog, clients, admins] = await Promise.all([getCatalog(actor), listClients(actor), listAdmins(actor)]);
  const initial = newWizardState(catalog, actor.userId);
  const pre = clients.find((c) => c.id === client);
  if (pre) {
    initial.client = { mode: "existing", client_id: pre.id };
    initial.contact = { name: pre.owner_name, email: pre.email, phone: pre.phone };
    initial.business_category = pre.business_category;
  } else if (clients.length === 0) {
    initial.client = { mode: "new", business_name: "", owner_name: "", email: "", phone: null, business_category: null };
  }
  return (
    <>
      <PageHead eyebrow="Proposals" title="New proposal" sub="Work through the steps — every save is recalculated on the server." />
      <ProposalWizard catalog={catalog} clients={clients} admins={admins} initial={initial} proposalId={null} />
    </>
  );
}
