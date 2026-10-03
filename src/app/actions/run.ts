import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "@/lib/errors";
import { getActor } from "@/lib/session";
import type { Actor } from "@/lib/db";

export type ActionState = { ok: boolean; message?: string; error?: string; data?: Record<string, unknown>; at?: number } | null;

type Result = void | string | { message?: string; data?: Record<string, unknown> };

/** Authenticate, run, translate errors into user-safe messages, and revalidate. */
export async function run(role: "admin" | "client" | "any", fn: (actor: Actor) => Promise<Result>): Promise<ActionState> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "Your session has expired. Please sign in again." };
    if (role !== "any" && actor.role !== role) return { ok: false, error: "You do not have permission to do that." };
    const r = await fn(actor);
    // Fresh data is fetched by the calling form via router.refresh(), which preserves client state.
    if (typeof r === "string") return { ok: true, message: r, at: Date.now() };
    return { ok: true, message: r?.message, data: r?.data, at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { ok: false, error: e.message, at: Date.now() };
    console.error("[action]", e);
    return { ok: false, error: "Something went wrong. Please try again.", at: Date.now() };
  }
}

/** FormData → plain object. Fields ending in [] become arrays; checkboxes become booleans. */
export function form(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v !== "string") continue;
    if (k.endsWith("[]")) ((out[k.slice(0, -2)] ??= []) as string[]).push(v);
    else out[k] = v;
  }
  return out;
}

export const checkbox = (fd: FormData, name: string) => fd.get(name) === "on" || fd.get(name) === "true";
