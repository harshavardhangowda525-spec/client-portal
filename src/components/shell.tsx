"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Toaster } from "./forms";

export type NavItem = { href: string; label: string; icon: IconName; count?: number; exact?: boolean };
export type NavGroup = { label?: string; items: NavItem[] };

export function Shell({ groups, user, children, topRight, logout }: {
  groups: NavGroup[]; user: { name: string; sub: string; initials: string }; children: ReactNode; topRight?: ReactNode; logout: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`));
  return (
    <div className="app" data-nav-open={open}>
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">∞</span>
          <span><span className="brand-name">Infinity Web &amp; Apps</span><br /><span className="brand-sub">Project Portal</span></span>
        </Link>
        {groups.map((g, gi) => (
          <nav className="nav" key={gi} aria-label={g.label ?? "Navigation"}>
            {g.label && <div className="nav-label">{g.label}</div>}
            {g.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={active(i) ? "page" : undefined}>
                <Icon name={i.icon} />{i.label}{i.count ? <span className="count" aria-label={`${i.count} unread`}>{i.count}</span> : null}
              </Link>
            ))}
          </nav>
        ))}
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{user.initials}</span>
            <div style={{ minWidth: 0 }}>
              <div className="small truncate" style={{ fontWeight: 500 }}>{user.name}</div>
              <div className="tiny faint truncate">{user.sub}</div>
            </div>
          </div>
          {logout}
        </div>
      </aside>
      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,.5)" }} aria-hidden="true" />}
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-toggle" onClick={() => setOpen((v) => !v)} aria-label="Open menu" aria-expanded={open}>
            <Icon name="menu" />
          </button>
          <div className="spacer" />
          {topRight}
        </header>
        <main id="main" className="content"><div key={path} className="page-anim">{children}</div></main>
        <Toaster />
      </div>
    </div>
  );
}
