import { requireClient } from "@/lib/session";
import { clientMeetings, PURPOSES } from "@/server/meetings";
import { clientProjects } from "@/server/dashboards";
import { fmtCall, MEETING_TYPES } from "@/server/booking";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { cancelMeetingAction } from "@/app/actions/growth";
import { MeetingPicker } from "./picker";

export const metadata = { title: "Meetings" };
export const dynamic = "force-dynamic";

const STATUS = { scheduled: ["Upcoming", "blue"], completed: ["Completed", "green"], cancelled: ["Cancelled", ""], no_show: ["Missed", "amber"] } as const;

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ reschedule?: string }> }) {
  const actor = await requireClient();
  const { reschedule } = await searchParams;
  const [m, projects] = await Promise.all([clientMeetings(actor), clientProjects(actor)]);
  const moving = m.upcoming.find((x) => x.id === reschedule) ?? null;
  return (
    <>
      <PageHead eyebrow="Meetings" title="Book time with our team" sub="Times are shown in India Standard Time (IST). Only times that are actually free in our calendar appear." />
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <Panel title={moving ? `Move your ${PURPOSES[moving.purpose ?? "consultation"].label.toLowerCase()}` : "Pick a time"}>
          {m.days.length === 0 ? (
            <Empty icon="calendar" title="No free times right now">Our calendar has no open slots at the moment. Please message us and we&apos;ll find a time.</Empty>
          ) : (
            <MeetingPicker days={m.days} meetingTypes={m.meetingTypes.map((t) => [t, MEETING_TYPES[t]] as [string, string])}
              purposes={Object.entries(PURPOSES).map(([k, v]) => ({ key: k, label: v.label, hint: v.hint, minutes: v.minutes }))}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))} replaces={moving?.id ?? null} initialPurpose={moving?.purpose ?? "consultation"} />
          )}
        </Panel>
        <div className="stack">
          <Panel title="Upcoming">
            {m.upcoming.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No meetings booked.</p> : (
              <div className="list">{m.upcoming.map((x) => (
                <div key={x.id} className="list-item" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>{PURPOSES[x.purpose ?? "consultation"].label}</div>
                    <div className="small muted">{fmtCall(x.starts_at)} · {MEETING_TYPES[x.meeting_type]}</div>
                    {x.meeting_link && <a className="small" href={x.meeting_link} target="_blank" rel="noopener noreferrer">Join link</a>}
                    <div className="row" style={{ marginTop: 8 }}>
                      <a className="btn btn-sm" href={`/portal/meetings?reschedule=${x.id}`}>Reschedule</a>
                      <ActionButton action={cancelMeetingAction.bind(null, x.id)} className="btn btn-sm btn-ghost" confirm="Cancel this meeting?">Cancel</ActionButton>
                    </div>
                  </div>
                </div>
              ))}</div>
            )}
          </Panel>
          <Panel title="Meeting history">
            {m.history.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Past meetings will appear here.</p> : (
              <div className="list">{m.history.map((x) => (
                <div key={x.id} className="list-item"><div className="grow"><div className="small" style={{ fontWeight: 500 }}>{PURPOSES[x.purpose ?? "consultation"].label}</div><div className="tiny faint">{fmtCall(x.starts_at)}</div></div>
                  <Badge tone={STATUS[x.status][1]} plain>{STATUS[x.status][0]}</Badge></div>
              ))}</div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
