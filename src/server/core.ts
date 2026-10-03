import { withDb, type Actor, type Ctx, type Tx, SYSTEM } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";

export { withDb, SYSTEM };
export type { Actor, Ctx, Tx };

export function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw forbidden();
}

/**
 * Run privileged statements inside the caller's transaction. Used only after the
 * caller's own access has been verified under RLS (e.g. a client accepting a quotation
 * they can see). Restores the actor's context afterwards.
 */
export async function asSystem<T>(tx: Tx, actor: Actor, fn: () => Promise<T>): Promise<T> {
  await tx`select set_config('app.role', 'system', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('app.role', ${actor.role}, true)`;
  }
}

export type ProjectRow = {
  id: string;
  client_id: string;
  name: string;
  project_type: string;
  description: string | null;
  status: string;
  current_stage: string | null;
  project_manager_id: string | null;
  start_date: string | null;
  target_delivery_date: string | null;
  commenced_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  is_sample: boolean;
  created_at: Date;
};

/** Load a project the actor may access. RLS hides other clients' projects, so they read as "not found". */
export async function getProjectFor(tx: Tx, actor: Actor, projectId: string): Promise<ProjectRow> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound("Project not found.");
  const [p] = await tx<ProjectRow[]>`select * from projects where id = ${projectId}`;
  if (!p) throw notFound("Project not found.");
  if (actor.role === "client" && p.client_id !== actor.clientId) throw forbidden();
  return p;
}

export async function audit(
  tx: Tx,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  projectId: string | null,
  data: Record<string, unknown> = {},
  ip?: string | null,
) {
  const run = () => tx`
    insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, project_id, data, ip)
    values (${actor?.userId ?? null}, ${actor?.role ?? "system"}, ${action}, ${entityType}, ${entityId}, ${projectId},
            ${tx.json(data as never)}, ${ip ?? null})`;
  if (actor && actor.role === "client") await asSystem(tx, actor, run);
  else await run();
}

/** Atomic yearly counter, e.g. IWA-Q-2026-0001. */
export async function nextNumber(tx: Tx, name: "Q" | "INV" | "RCPT"): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await tx<{ value: number }[]>`
    insert into counters (name, year, value) values (${name}, ${year}, 1)
    on conflict (name, year) do update set value = counters.value + 1
    returning value`;
  return `IWA-${name}-${year}-${String(row.value).padStart(4, "0")}`;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export { AppError };
