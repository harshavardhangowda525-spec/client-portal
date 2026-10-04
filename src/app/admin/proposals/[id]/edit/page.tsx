import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getCatalog } from "@/server/pricing";
import { listAdmins, listClients } from "@/server/clients";
import { getWizardState } from "@/server/proposals";
import { PageHead, ProposalBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { reviseProposalAction } from "@/app/actions/proposals";
import { AppError } from "@/lib/errors";
import { ProposalWizard } from "../../wizard";
import type { WizardState } from "../../wizard-state";

export const metadata = { title: "Edit proposal" };
export const dynamic = "force-dynamic";

export default async function EditProposal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;
  const { step } = await searchParams;
  let w: Awaited<ReturnType<typeof getWizardState>>;
  try { w = await getWizardState(actor, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  if (w.locked) {
    return (
      <div className="narrow-wrap">
        <PageHead eyebrow={<Link href={`/admin/proposals/${id}`}>{w.number}</Link>} title="This version is locked" />
        <div className="glass panel stack">
          <p className="muted">Version {w.versionNo} is <ProposalBadge status={w.status} /> and cannot be edited. Create a revised version — the client will need to approve it again.</p>
          <div className="row"><ActionButton action={reviseProposalAction.bind(null, id)} className="btn btn-primary">Create revised version</ActionButton>
            <Link className="btn" href={`/admin/proposals/${id}`}>Back to proposal</Link></div>
        </div>
      </div>
    );
  }
  const [catalog, clients, admins] = await Promise.all([getCatalog(actor), listClients(actor), listAdmins(actor)]);
  return (
    <>
      <PageHead eyebrow={<Link href={`/admin/proposals/${id}`}>{w.number}</Link>} title={`Edit proposal · version ${w.versionNo}`} />
      <ProposalWizard catalog={catalog} clients={clients} admins={admins} initial={w.input as unknown as WizardState} proposalId={id} number={w.number}
        initialStep={Math.min(Math.max(Number(step) || 0, 0), 7)} />
    </>
  );
}
