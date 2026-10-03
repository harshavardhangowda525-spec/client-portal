import Link from "next/link";
import { inspectInvitation } from "@/server/clients";
import { Empty } from "@/components/ui";
import { InviteForm } from "./form";

export const metadata = { title: "Join your project portal" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await inspectInvitation(token);
  return (
    <div className="auth">
      <div className="glass auth-card" style={{ maxWidth: 460 }}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">∞</span>
          <span><span className="brand-name">Infinity Web &amp; Apps</span><br /><span className="brand-sub">Project Portal</span></span>
        </div>
        {inv.state === "valid" ? (
          <>
            <h1 style={{ fontSize: "1.3rem", textAlign: "center" }}>Welcome, {inv.ownerName}</h1>
            <p className="muted small" style={{ textAlign: "center", margin: "6px 0 22px" }}>
              Your private project portal for <strong>{inv.businessName}</strong> is ready.
              {inv.hasAccount ? " Confirm your password to add this project to your account." : " Create your password to get started."}
            </p>
            <InviteForm token={token} email={inv.email!} ownerName={inv.ownerName!} hasAccount={!!inv.hasAccount} />
          </>
        ) : (
          <Empty icon="link" title={
            inv.state === "used" ? "This invitation has already been used" :
            inv.state === "expired" ? "This invitation has expired" :
            inv.state === "revoked" ? "This invitation is no longer valid" : "Invalid invitation link"}
            action={<Link href="/login" className="btn btn-primary">Go to sign in</Link>}>
            {inv.state === "used" ? "You can sign in with the email and password you created." : "Please ask Infinity Web & Apps to send you a new invitation link."}
          </Empty>
        )}
      </div>
    </div>
  );
}
