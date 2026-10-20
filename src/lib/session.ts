import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createHmac, timingSafeEqual } from "node:crypto";
import { actorFromToken, clientActor } from "@/server/auth";
import type { Actor } from "./db";

export const SESSION_COOKIE = "iwa_session";

export const VIEW_AS_COOKIE = "iwa_view_as";
export const VIEW_AS_MINUTES = 60;

// "View as client" cookie: `<clientUserId>.<expiresMs>.<hmac>`, signed with the admin's own session
// token, so it is worthless without that session and ends when the admin signs out.
const viewAsSig = (token: string, payload: string) => createHmac("sha256", token).update(`view-as:${payload}`).digest("base64url");
export function viewAsValue(token: string, clientUserId: string, expiresAt: number) {
  const payload = `${clientUserId}.${expiresAt}`;
  return `${payload}.${viewAsSig(token, payload)}`;
}
function readViewAs(token: string, value: string | undefined): { userId: string; expiresAt: number } | null {
  const m = /^([0-9a-f-]{36})\.(\d{10,16})\.([\w-]{43})$/.exec(value ?? "");
  if (!m) return null;
  const want = Buffer.from(viewAsSig(token, `${m[1]}.${m[2]}`));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const expiresAt = Number(m[2]);
  return expiresAt > Date.now() ? { userId: m[1], expiresAt } : null;
}

export const getActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const actor = await actorFromToken(token);
  if (!actor || actor.role !== "admin" || !token) return actor;
  // The view-as cookie is scoped to /portal, so admin pages always see the real admin.
  const v = readViewAs(token, jar.get(VIEW_AS_COOKIE)?.value);
  if (!v) return actor;
  const client = await clientActor(v.userId);
  return client ? { ...client, viewAs: { adminId: actor.userId, adminName: actor.name, expiresAt: v.expiresAt } } : actor;
});

/** Sign-in page that returns to the current page afterwards (path supplied by middleware). */
async function loginUrl() {
  const path = (await headers()).get("x-pathname");
  return path && path.startsWith("/") && !path.startsWith("//") ? `/login?next=${encodeURIComponent(path)}` : "/login";
}

export async function requireAdmin(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect(await loginUrl());
  if (a.role !== "admin") redirect("/portal");
  return a;
}

export async function requireClient(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect(await loginUrl());
  if (a.role !== "client") redirect("/admin");
  return a;
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  return { ip, ua: h.get("user-agent") };
}
