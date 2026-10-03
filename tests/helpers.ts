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
