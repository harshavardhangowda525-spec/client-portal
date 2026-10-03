import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { actorFromToken } from "@/server/auth";
import type { Actor } from "./db";

export const SESSION_COOKIE = "iwa_session";

export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return actorFromToken(token);
});

export async function requireAdmin(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  if (a.role !== "admin") redirect("/portal");
  return a;
}

export async function requireClient(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
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
