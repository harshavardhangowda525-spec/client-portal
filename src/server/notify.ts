import { asSystem, type Actor, type Tx } from "./core";

type Note = { type: string; title: string; body?: string | null; link?: string | null; projectId?: string | null };

async function insertFor(tx: Tx, userIds: string[], n: Note) {
  if (userIds.length === 0) return;
  const rows = userIds.map((user_id) => ({
    user_id, project_id: n.projectId ?? null, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null,
  }));
  await tx`insert into notifications ${tx(rows)}`;
}

async function elevated<T>(tx: Tx, actor: Actor | null, fn: () => Promise<T>) {
  return actor && actor.role === "client" ? asSystem(tx, actor, fn) : fn();
}

/** Notify all active admins (e.g. client accepted a quotation or submitted feedback). */
export async function notifyAdmins(tx: Tx, actor: Actor | null, n: Note) {
  await elevated(tx, actor, async () => {
    const admins = await tx<{ id: string }[]>`select id from users where role = 'admin' and disabled_at is null`;
    await insertFor(tx, admins.map((a) => a.id).filter((id) => id !== actor?.userId), n);
  });
}

/** Notify the client users who are members of a project. */
export async function notifyProjectClients(tx: Tx, actor: Actor | null, projectId: string, n: Note) {
  await elevated(tx, actor, async () => {
    const members = await tx<{ id: string }[]>`
      select u.id from project_members m join users u on u.id = m.user_id
      where m.project_id = ${projectId} and u.role = 'client' and u.disabled_at is null`;
    await insertFor(tx, members.map((m) => m.id).filter((id) => id !== actor?.userId), { ...n, projectId });
  });
}

/** Notify every active portal user of a client (proposals exist before any project does). */
export async function notifyClientUsers(tx: Tx, actor: Actor | null, clientId: string, n: Note) {
  await elevated(tx, actor, async () => {
    const users = await tx<{ id: string }[]>`
      select id from users where client_id = ${clientId} and role = 'client' and disabled_at is null`;
    await insertFor(tx, users.map((u) => u.id).filter((id) => id !== actor?.userId), n);
  });
}
