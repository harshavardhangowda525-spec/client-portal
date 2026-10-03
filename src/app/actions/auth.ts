"use server";

import { redirect } from "next/navigation";
import { login, logout as endSession, changePassword, createAdmin, adminCount, createSession } from "@/server/auth";
import { acceptInvitation } from "@/server/clients";
import { AppError } from "@/lib/errors";
import { clearSessionCookie, setSessionCookie, requestMeta, SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";
import { safeEqualHex } from "@/lib/crypto";
import { run, type ActionState } from "./run";

function safeNext(next: unknown, role: string) {
  const n = typeof next === "string" ? next : "";
  const prefix = role === "admin" ? "/admin" : "/portal";
  return n.startsWith(prefix) && !n.startsWith("//") ? n : prefix;
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password." };
  let dest: string;
  try {
    const { ip, ua } = await requestMeta();
    const s = await login(email, password, ip, ua);
    await setSessionCookie(s.token, s.expires);
    dest = safeNext(fd.get("next"), s.role);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[login]", e);
    return { ok: false, error: "Sign-in is temporarily unavailable. Please try again." };
  }
  redirect(dest);
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await endSession(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function acceptInviteAction(token: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  const confirm = fd.get("confirm");
  if (confirm !== null && confirm !== password) return { ok: false, error: "The passwords do not match." };
  try {
    const { ip, ua } = await requestMeta();
    const s = await acceptInvitation(token, { name: String(fd.get("name") ?? ""), password }, ip, ua);
    await setSessionCookie(s.token, s.expires);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[invite]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  redirect("/portal");
}

export async function setupAdminAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const expected = process.env.ADMIN_SETUP_TOKEN ?? "";
  const given = String(fd.get("setup_token") ?? "");
  if (expected.length < 16) return { ok: false, error: "Browser setup is disabled. Use `npm run admin:create` on the server." };
  if (!safeEqualHex(expected, given)) return { ok: false, error: "Invalid setup token." };
  if ((await adminCount()) > 0) return { ok: false, error: "An admin account already exists. Setup is closed." };
  if (fd.get("password") !== fd.get("confirm")) return { ok: false, error: "The passwords do not match." };
  try {
    const id = await createAdmin(String(fd.get("name") ?? ""), String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    const { ip, ua } = await requestMeta();
    const s = await createSession(id, ip, ua);
    await setSessionCookie(s.token, s.expires);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
  redirect("/admin");
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (fd.get("next") !== fd.get("confirm")) return { ok: false, error: "The new passwords do not match." };
  return run("any", async (actor) => {
    await changePassword(actor, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""));
    return "Password updated.";
  });
}
