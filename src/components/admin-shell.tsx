import type { ReactNode } from "react";
import Link from "next/link";
import { Shell } from "./shell";
import { initials } from "./ui";
import { Icon } from "./icons";
import { logoutAction } from "@/app/actions/auth";
import { unreadNotificationCount } from "@/server/content";
import type { Actor } from "@/lib/db";

export async function AdminShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const unread = await unreadNotificationCount(actor);
  return (
    <Shell
      groups={[
        { label: "Workspace", items: [
          { href: "/admin", label: "Dashboard", icon: "grid", exact: true },
          { href: "/admin/proposals", label: "Proposals", icon: "file" },
          { href: "/admin/projects", label: "Projects", icon: "briefcase" },
          { href: "/admin/clients", label: "Clients", icon: "users" },
          { href: "/admin/templates", label: "Quotation templates", icon: "template" },
        ] },
        { label: "Account", items: [
          { href: "/admin/notifications", label: "Notifications", icon: "bell", count: unread },
          { href: "/admin/settings", label: "Settings", icon: "settings", exact: true },
          { href: "/admin/settings/pricing", label: "Pricing configuration", icon: "wallet" },
        ] },
      ]}
      user={{ name: actor.name, sub: "Administrator", initials: initials(actor.name) }}
      logout={<form action={logoutAction}><button className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: "flex-start" }}><Icon name="logout" /> Sign out</button></form>}
      topRight={
        <>
          <Link href="/admin/clients/new" className="btn btn-sm btn-primary"><Icon name="plus" /> New client</Link>
          <Link href="/admin/notifications" className="btn btn-ghost icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} style={{ position: "relative" }}>
            <Icon name="bell" />
            {unread > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: 99, background: "var(--blue)" }} />}
          </Link>
        </>
      }
    >
      {children}
    </Shell>
  );
}
