import Link from "next/link";
import { ActionButton } from "../forms";
import { Empty } from "../ui";
import { Icon } from "../icons";
import { timeAgo } from "@/lib/format";
import { markNotificationsReadAction } from "@/app/actions/shared";

type N = { id: string; title: string; body: string | null; link: string | null; read_at: Date | null; created_at: Date };

export function NotificationList({ items }: { items: N[] }) {
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="glass panel">
      <div className="panel-head">
        <span className="small muted">{unread} unread</span>
        {unread > 0 && <ActionButton action={markNotificationsReadAction.bind(null, undefined)} className="btn btn-sm">Mark all as read</ActionButton>}
      </div>
      {items.length === 0 ? <Empty icon="bell" title="You're all caught up">New quotations, updates and payment confirmations will appear here.</Empty> : (
        <div className="list">
          {items.map((n) => (
            <div key={n.id} className="list-item" style={{ alignItems: "flex-start", opacity: n.read_at ? 0.65 : 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, marginTop: 7, background: n.read_at ? "transparent" : "var(--blue)", flex: "none" }} aria-hidden="true" />
              <div className="grow">
                <div className="small" style={{ fontWeight: 500 }}>{n.title}</div>
                {n.body && <div className="small muted pre" style={{ marginTop: 2 }}>{n.body}</div>}
                <div className="tiny faint" style={{ marginTop: 2 }}>{timeAgo(n.created_at)}{!n.read_at && <span className="sr-only"> (unread)</span>}</div>
              </div>
              <div className="row">
                {n.link && <Link className="btn btn-sm btn-ghost" href={n.link}>Open <Icon name="external" /></Link>}
                {!n.read_at && <ActionButton action={markNotificationsReadAction.bind(null, n.id)} className="btn btn-sm btn-ghost">Mark read</ActionButton>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
