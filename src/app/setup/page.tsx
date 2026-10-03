import { notFound } from "next/navigation";
import { adminCount } from "@/server/auth";
import { SetupForm } from "./form";

export const metadata = { title: "Initial setup" };
export const dynamic = "force-dynamic";

/** One-time admin bootstrap. Only exists while ADMIN_SETUP_TOKEN is set and no admin has been created. */
export default async function SetupPage() {
  if ((process.env.ADMIN_SETUP_TOKEN ?? "").length < 16 || (await adminCount()) > 0) notFound();
  return (
    <div className="auth">
      <div className="glass auth-card" style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: "1.3rem" }}>Create the first admin account</h1>
        <p className="muted small" style={{ margin: "6px 0 20px" }}>Enter the setup token from your server environment. This page disappears once an admin exists.</p>
        <SetupForm />
      </div>
    </div>
  );
}
