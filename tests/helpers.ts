import * as P from "@/server/proposals";
import * as Pricing from "@/server/pricing";
import { withDb, SYSTEM, type Actor } from "@/lib/db";
import { createAdmin } from "@/server/auth";
import { createClient, createProject, inviteClient, acceptInvitation } from "@/server/clients";
import { actorFromToken } from "@/server/auth";

let n = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

export async function makeAdmin(): Promise<Actor> {
  const email = `${uniq("admin")}@example.test`;
  const id = await createAdmin("Test Admin", email, "Sup3rSecretPass");
  return { userId: id, role: "admin", clientId: null, name: "Test Admin", email };
}

/** Admin creates a client + project, invites, and the client accepts. Returns the client actor. */
export async function makeClientWithProject(admin: Actor, label = "Cafe") {
  const email = `${uniq(label.toLowerCase())}@example.test`;
  const clientId = await createClient(admin, { business_name: `${label} Bistro`, owner_name: `${label} Owner`, email, phone: "9876543210" });
  const projectId = await createProject(admin, clientId, { name: `${label} Website`, project_type: "website", start_date: "2026-10-01", target_delivery_date: "2026-11-15" });
  const inv = await inviteClient(admin, clientId, { email, project_id: projectId });
  const token = inv.link.split("/invite/")[1];
  const session = await acceptInvitation(token, { name: `${label} Owner`, password: "ClientPass123" });
  const client = (await actorFromToken(session.token))!;
  return { clientId, projectId, client, email, sessionToken: session.token };
}

export async function rawAs<T>(actor: Actor, fn: Parameters<typeof withDb<T>>[1]) {
  return withDb(actor, fn);
}

export async function rawSystem<T>(fn: Parameters<typeof withDb<T>>[1]) {
  return withDb(SYSTEM, fn);
}

// ---- proposals (proposals price and bill projects) ----
const future = (days = 15) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

export async function websitePackage(admin: Actor) {
  const cat = await Pricing.getCatalog(admin);
  const w = cat.packages.find((p) => p.kind === "website")!;
  return { id: w.id, price: Number(w.price) };
}

export async function proposalInput(admin: Actor, clientId: string, over: Record<string, unknown> = {}) {
  const pkg = await websitePackage(admin);
  return {
    client: { mode: "existing", client_id: clientId },
    contact: { name: "Client Owner", email: "owner@example.test", phone: "9876543210" },
    title: "Website", project_type: "website", description: "Website", requirements: null, target_launch_date: null, assigned_to: null,
    internal_notes: "internal only", executive_summary: null, recommended_solution: null,
    pricing: { mode: "package", package_ids: [pkg.id], addons: [], custom: [] },
    scope_details: { platforms: [], pages: 5 }, externals: [], maintenance: null, warranty: { days: 30, terms: "Bug fixes." },
    scope: { objectives: null, features: [], pages_screens: [], design_requirements: null, deliverables: [], client_responsibilities: [], content_requirements: null,
      revisions: 2, milestones: [], timeline: null, acceptance_criteria: null, exclusions: [], assumptions: [] },
    discount: { rule_id: null, type: "none", value: 0, max_amount: null },
    milestones: [{ label: "Initial advance", mode: "percent", value: 50, due: "On acceptance" }, { label: "Handover", mode: "percent", value: 50, due: "Before launch" }],
    valid_until: future(), terms: "Standard terms",
    ...over,
  };
}

/** Admin creates and sends a proposal for the project (it links to the project automatically). */
export async function sendProjectProposal(admin: Actor, clientId: string, projectId: string | null, over: Record<string, unknown> = {}) {
  const r = await P.saveProposal(admin, null, await proposalInput(admin, clientId, { project_id: projectId, ...over }));
  await P.sendProposal(admin, r.proposalId);
  return { proposalId: r.proposalId, versionId: r.versionId, total: r.computed.total };
}

export async function acceptAsClient(client: Actor, proposalId: string, signer = client.name) {
  const { version, hash } = await P.getProposal(client, proposalId);
  await P.acceptProposal(client, version.id, { signer_name: signer, confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: hash });
  return version.id;
}
