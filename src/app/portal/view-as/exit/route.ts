import { NextResponse } from "next/server";
import { getActor, VIEW_AS_COOKIE } from "@/lib/session";

/** Leave "view as client" and return to the client's admin page. */
export async function GET(req: Request) {
  const actor = await getActor();
  const dest = actor?.viewAs && actor.clientId ? `/admin/clients/${actor.clientId}` : "/admin";
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.set(VIEW_AS_COOKIE, "", { path: "/portal", expires: new Date(0), httpOnly: true, sameSite: "lax" });
  return res;
}
