import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./icons";
import { MILESTONE_STATUS, PROJECT_STATUS, QUOTE_STATUS, PREVIEW_STATUS, INVOICE_STATUS } from "@/lib/format";
import { formatMoney } from "@/lib/money";

type Tone = "blue" | "green" | "amber" | "red" | "violet" | "";

export function Badge({ tone = "", children, pulse, plain }: { tone?: Tone; children: ReactNode; pulse?: boolean; plain?: boolean }) {
  return <span className={`badge ${tone} ${pulse ? "pulse" : ""} ${plain ? "plain" : ""}`}>{children}</span>;
}

const milestoneTone: Record<string, Tone> = { completed: "green", in_progress: "blue", awaiting_client: "amber", blocked: "red", not_started: "" };
export const MilestoneBadge = ({ status }: { status: string }) => (
  <Badge tone={milestoneTone[status]} pulse={status === "in_progress"}>{MILESTONE_STATUS[status] ?? status}</Badge>
);

const projectTone: Record<string, Tone> = { proposal: "violet", quotation_accepted: "amber", active: "blue", awaiting_client: "amber", on_hold: "", completed: "green", cancelled: "red", declined: "red" };
export const ProjectBadge = ({ status }: { status: string }) => <Badge tone={projectTone[status]}>{PROJECT_STATUS[status] ?? status}</Badge>;

const quoteTone: Record<string, Tone> = { draft: "", sent: "blue", viewed: "violet", accepted: "green", changes_requested: "amber", rejected: "red", expired: "red", superseded: "", withdrawn: "" };
export const QuoteBadge = ({ status }: { status: string }) => <Badge tone={quoteTone[status]}>{QUOTE_STATUS[status] ?? status}</Badge>;

const previewTone: Record<string, Tone> = { ready_for_review: "blue", changes_requested: "amber", approved: "green", superseded: "" };
export const PreviewBadge = ({ status }: { status: string }) => <Badge tone={previewTone[status]}>{PREVIEW_STATUS[status] ?? status}</Badge>;

const invoiceTone: Record<string, Tone> = { draft: "", issued: "blue", partially_paid: "amber", paid: "green", void: "", overdue: "red" };
export const InvoiceBadge = ({ status, overdue }: { status: string; overdue?: boolean }) =>
  overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone={invoiceTone[status]}>{INVOICE_STATUS[status] ?? status}</Badge>;

const paymentTone: Record<string, Tone> = { pending: "amber", confirmed: "green", failed: "red", refunded: "violet" };
export const PaymentBadge = ({ status }: { status: string }) => (
  <Badge tone={paymentTone[status]}>{status === "pending" ? "Awaiting confirmation" : status[0].toUpperCase() + status.slice(1)}</Badge>
);

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label ?? "Progress"}>
      <span style={{ ["--value" as string]: `${value}%` }} />
    </div>
  );
}

export function ProgressRing({ value, caption = "complete" }: { value: number; caption?: string }) {
  const r = 56;
  const circ = 2 * Math.PI * r;
  return (
    <div className="ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={`Project ${value}% ${caption}`}>
      <svg viewBox="0 0 132 132" width="100%" height="100%">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6aa8ff" />
            <stop offset="100%" stopColor="#2f6fff" />
          </linearGradient>
        </defs>
        <circle className="track" cx="66" cy="66" r={r} fill="none" strokeWidth="10" />
        <circle className="bar" cx="66" cy="66" r={r} fill="none" strokeWidth="10" strokeDasharray={circ}
          strokeDashoffset={circ * (1 - value / 100)} style={{ ["--circ" as string]: circ }} />
      </svg>
      <div className="label"><div><strong>{value}%</strong><span>{caption}</span></div></div>
    </div>
  );
}

export function Empty({ icon = "sparkle", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Panel({ title, sub, actions, children, className = "", id }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`glass panel ${className}`} id={id}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export const Money = ({ value, currency = "INR" }: { value: number | null | undefined; currency?: string }) =>
  <span className="mono">{value == null ? "—" : formatMoney(Number(value), currency)}</span>;

export function Tabs({ items, current }: { items: { href: string; label: ReactNode }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((t) => <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
}
