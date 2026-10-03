import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getActor();
  if (actor) redirect(actor.role === "admin" ? "/admin" : "/portal");
  const { next } = await searchParams;
  return (
    <div className="auth">
      <div className="glass auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">∞</span>
          <span><span className="brand-name">Infinity Web &amp; Apps</span><br /><span className="brand-sub">Project Portal</span></span>
        </div>
        <h1 style={{ fontSize: "1.3rem", textAlign: "center" }}>Welcome back</h1>
        <p className="muted small" style={{ textAlign: "center", margin: "6px 0 22px" }}>Sign in to view your project.</p>
        <LoginForm next={next} />
        <p className="tiny faint" style={{ textAlign: "center", marginTop: 20 }}>
          New client? Use the private invitation link sent to you by Infinity Web &amp; Apps.
        </p>
      </div>
    </div>
  );
}
