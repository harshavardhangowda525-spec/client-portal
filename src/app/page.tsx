import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";

export default async function Home() {
  const actor = await getActor();
  redirect(!actor ? "/login" : actor.role === "admin" ? "/admin" : "/portal");
}
