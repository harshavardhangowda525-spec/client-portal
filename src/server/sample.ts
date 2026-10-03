import { withDb, SYSTEM, type Actor } from "@/lib/db";
import * as C from "./clients";
import * as Q from "./quotations";
import * as M from "./milestones";
import * as X from "./content";

/**
 * Clearly-labelled sample data for testing. Every sample row is flagged is_sample
 * and uses @example.test addresses. Remove with `npm run sample:remove`.
 */
export async function seedSampleData() {
  const [admin] = await withDb(SYSTEM, (tx) => tx<{ id: string; name: string; email: string }[]>`select id, name, email from users where role = 'admin' and disabled_at is null order by created_at limit 1`);
  if (!admin) throw new Error("Create an admin first: npm run admin:create");
  const actor: Actor = { userId: admin.id, role: "admin", clientId: null, name: admin.name, email: admin.email };
  const clientId = await C.createClient(actor, { business_name: "[SAMPLE] Brew & Bloom Cafe", owner_name: "Sample Owner", email: "sample.owner@example.test", phone: "9000000000", business_category: "Cafe / restaurant" });
  const projectId = await C.createProject(actor, clientId, { name: "[SAMPLE] Cafe Website Development", project_type: "website", project_manager_id: actor.userId,
    description: "Sample project for testing the portal.", start_date: new Date().toISOString().slice(0, 10) });
  await withDb(SYSTEM, async (tx) => {
    await tx`update client_profiles set is_sample = true where id = ${clientId}`;
    await tx`update projects set is_sample = true where id = ${projectId}`;
  });
  const { versionId } = await Q.createQuotation(actor, projectId, { title: "[SAMPLE] Cafe website quotation" });
  await Q.sendQuotation(actor, versionId);
  const ms = await M.listMilestones(actor, projectId);
  await M.updateMilestone(actor, ms[0].id, { ...ms[0], status: "completed", note: "Sample: offer accepted" });
  await M.updateMilestone(actor, ms[1].id, { ...ms[1], status: "in_progress", note: "Sample: gathering menu and photos" });
  await X.postUpdate(actor, projectId, { title: "[SAMPLE] Welcome to your project portal", body: "This is sample data used for testing.", kind: "general", visibility: "client" });
  const inv = await C.inviteClient(actor, clientId, { email: "sample.owner@example.test", project_id: projectId });
  return { clientId, projectId, inviteLink: inv.link };
}

export async function removeSampleData() {
  return withDb(SYSTEM, async (tx) => {
    await tx`select set_config('app.purge', 'on', true)`;
    const projects = await tx`delete from projects where is_sample returning id`;
    const clients = await tx`delete from client_profiles where is_sample returning id`;
    await tx`select set_config('app.purge', 'off', true)`;
    await tx`insert into audit_logs (actor_role, action, entity_type, data) values ('system', 'sample_data.removed', 'system', ${tx.json({ projects: projects.length, clients: clients.length })})`;
    return { projects: projects.length, clients: clients.length };
  });
}

