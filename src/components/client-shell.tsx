import type { ReactNode } from "react";
import { Shell, type NavGroup } from "./shell";
import { initials } from "./ui";
import { Icon } from "./icons";
import { logoutAction } from "@/app/actions/auth";
import { clientProjects } from "@/server/dashboards";
import { unreadMessageCount, unreadNotificationCount } from "@/server/content";
import { listClientProposals } from "@/server/proposals";
import type { Actor } from "@/lib/db";
import Link from "next/link";

export async function ClientShell({ actor, projectId, children }: { actor: Actor; projectId?: string; children: ReactNode }) {
  const [projects, unreadNotes, unreadMsgs, proposals] = await Promise.all([
    clientProjects(actor),
    unreadNotificationCount(actor),
    projectId ? unreadMessageCount(actor, projectId) : Promise.resolve(0),
    listClientProposals(actor),
  ]);
  const awaiting = proposals.filter((p) => ["sent", "viewed"].includes(p.status)).length;
  const pid = projectId ?? projects[0]?.id;
  const groups: NavGroup[] = [];
  if (pid) {
    const base = `/portal/${pid}`;
    groups.push({
      label: projects.find((p) => p.id === pid)?.name ?? "Project",
      items: [
        { href: base, label: "Overview", icon: "home", exact: true },
        { href: `${base}/timeline`, label: "Timeline", icon: "timeline" },
        { href: `${base}/proposal`, label: "Proposal", icon: "file" },
        { href: `${base}/preview`, label: "Website preview", icon: "eye" },
        { href: `${base}/app`, label: "App review", icon: "phone" },
        { href: `${base}/payments`, label: "Invoices & payments", icon: "wallet" },
        { href: `${base}/maintenance`, label: "Maintenance & billing", icon: "wrench" },
        { href: `${base}/updates`, label: "Updates", icon: "activity" },
        { href: `${base}/messages`, label: "Messages", icon: "chat", count: unreadMsgs },
        { href: `${base}/documents`, label: "Documents", icon: "folder" },
      ],
    });
  }
  groups.push({
    label: "Account",
    items: [
      { href: "/portal/proposals", label: "Proposals", icon: "file", count: awaiting },
      ...(pid ? [
        { href: `/portal/${pid}/notifications`, label: "Notifications", icon: "bell" as const, count: unreadNotes },
        { href: `/portal/${pid}/account`, label: "Account", icon: "settings" as const },
      ] : []),
    ],
  });
  if (projects.length > 1) {
    groups.push({ label: "Your projects", items: projects.map((p) => ({ href: `/portal/${p.id}`, label: p.name, icon: "briefcase" as const, exact: true })) });
  }
  const business = projects[0]?.business_name ?? "";
  const viewing = actor.viewAs;
  return (
    <Shell
      groups={groups}
      user={{ name: actor.name, sub: business || actor.email, initials: initials(actor.name) }}
      logout={viewing
        ? <a href="/portal/view-as/exit" className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: "flex-start" }}><Icon name="logout" /> Exit client view</a>
        : <form action={logoutAction}><button className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: "flex-start" }}><Icon name="logout" /> Sign out</button></form>}
      banner={viewing ? (
        <div className="view-as-banner" role="status">
          <Icon name="eye" />
          <span>Viewing as <strong>{actor.name}</strong>{business ? ` (${business})` : ""}: read-only. Nothing you open here is saved or shown to the client.</span>
          <a href="/portal/view-as/exit" className="btn btn-sm">Exit client view</a>
        </div>
      ) : undefined}
      topRight={pid ? (
        <Link href={`/portal/${pid}/notifications`} className="btn btn-ghost icon-btn" aria-label={`Notifications${unreadNotes ? `, ${unreadNotes} unread` : ""}`} style={{ position: "relative" }}>
          <Icon name="bell" />
          {unreadNotes > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: 99, background: "var(--blue)" }} />}
        </Link>
      ) : null}
    >
      {children}
    </Shell>
  );
}
