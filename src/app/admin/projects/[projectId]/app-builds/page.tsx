import { requireAdmin } from "@/lib/session";
import { listAppBuilds } from "@/server/app-builds";
import { Empty, Panel, PreviewBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { CommentForm, CommentList } from "@/components/views/comments";
import { deleteAppBuildAction } from "@/app/actions/admin";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { PublishAppBuildForm } from "./publish";

export const dynamic = "force-dynamic";
const PLATFORM = { android: "Android", ios: "iOS", both: "Android & iOS" } as const;

export default async function AdminAppBuilds({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const builds = await listAppBuilds(actor, projectId);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        {builds.length === 0 ? <div className="glass panel"><Empty icon="phone" title="No app builds published">The client sees “App not ready yet” until you publish the first build.</Empty></div> :
          builds.map((b) => (
            <Panel key={b.id} title={`Version ${b.version_no}${b.build_label ? ` · ${b.build_label}` : ""}`} sub={PLATFORM[b.platform]}
              actions={<div className="row"><PreviewBadge status={b.status} />
                {b.status !== "approved" && <ActionButton action={deleteAppBuildAction.bind(null, b.id)} className="btn btn-sm btn-ghost" confirm={`Delete version ${b.version_no} and its files?`}><Icon name="trash" /><span className="sr-only">Delete version {b.version_no}</span></ActionButton>}</div>}>
              <div className="stack-sm">
                <span className="tiny faint">Published {fmtDateTime(b.published_at)}{b.reviewed_at ? ` · ${b.status === "approved" ? "approved" : "reviewed"} by ${b.reviewer_name ?? "client"} ${fmtDateTime(b.reviewed_at)}` : ""}</span>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {b.apk && <a className="btn btn-sm" href={`/api/documents/${b.apk.id}?download`}><Icon name="download" /> {b.apk.name} ({fmtBytes(b.apk.size_bytes)})</a>}
                  {b.android_url && <a className="btn btn-sm" href={b.android_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Android link</a>}
                  {b.ios_url && <a className="btn btn-sm" href={b.ios_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> TestFlight</a>}
                  {b.test_url && <a className="btn btn-sm" href={b.test_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Test link</a>}
                </div>
                {b.notes && <p className="small muted pre">{b.notes}</p>}
                {b.screenshots.length > 0 && <div className="row" style={{ flexWrap: "wrap" }}>{b.screenshots.map((s) => <a key={s.id} className="btn btn-sm" href={`/api/documents/${s.id}`} target="_blank" rel="noopener"><Icon name="eye" /> {s.name}</a>)}</div>}
              </div>
              <hr />
              <h3 className="small" style={{ marginBottom: 4 }}>Client feedback</h3>
              <CommentList comments={b.comments} />
              {b.clientScreenshots.length > 0 && <div className="row" style={{ flexWrap: "wrap", margin: "6px 0" }}>{b.clientScreenshots.map((s) => <a key={s.id} className="btn btn-sm" href={`/api/documents/${s.id}`} target="_blank" rel="noopener"><Icon name="eye" /> Client screenshot: {s.name}</a>)}</div>}
              <CommentForm projectId={projectId} targetType="app_build" targetId={b.id} placeholder="Reply to the client…" />
            </Panel>
          ))}
      </div>
      <Panel title="Publish an app build" sub="The client installs it, tests it, then approves or requests changes."><PublishAppBuildForm projectId={projectId} /></Panel>
    </div>
  );
}
