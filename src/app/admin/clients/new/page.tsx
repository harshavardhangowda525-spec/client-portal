import { requireAdmin } from "@/lib/session";
import { PageHead, Panel } from "@/components/ui";
import { ClientForm } from "../client-form";
import { createClientAction } from "@/app/actions/admin";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <div className="narrow-wrap">
      <PageHead eyebrow="Step 1 of 3" title="Add a client" sub="Next you will create their project, then prepare a quotation and invite them to the portal." />
      <Panel><ClientForm action={createClientAction} submitLabel="Create client" /></Panel>
    </div>
  );
}
