import Link from "next/link";
import { requireClient } from "@/lib/session";
import { listAppBuilds } from "@/server/app-builds";
import { Empty, PageHead, Panel, PreviewBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { CommentForm, CommentList } from "@/components/views/comments";
import { AppBuildReview } from "./review";
import { fmtBytes, fmtDate } from "@/lib/format";

export const metadata = { title: "App review" };
const PLATFORM = { android: "Android", ios: "iPhone (iOS)", both: "Android & iPhone" } as const;

export default async function AppReviewPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ v?: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const { v } = await searchParams;
  const builds = await listAppBuilds(actor, projectId);
  if (builds.length === 0) {
    return (
      <>
        <PageHead eyebrow="App review" title="App not ready yet" />
        <div className="glass panel">
          <Empty icon="phone" title="Your app isn't ready to test yet">
            When the first version of your app is ready, it will appear here with simple steps to install it on your phone.
          </Empty>
        </div>
      </>
    );
  }
  const b = builds.find((x) => x.id === v) ?? builds[0];
  const latest = b.id === builds[0].id;
  const open = latest && (b.status === "ready_for_review" || b.status === "changes_requested");
  return (
    <>
      <PageHead eyebrow="App review" title={`Version ${b.version_no}${b.build_label ? ` · ${b.build_label}` : ""}`}
        sub={<>{PLATFORM[b.platform]} · published {fmtDate(b.published_at)} · <PreviewBadge status={b.status} /></>} />
      {!latest && <div className="notice info section" style={{ marginTop: 0 }}>This is an older version. <Link href="?">See the latest version →</Link></div>}

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Install & test">
            <div className="stack">
              {b.apk && (
                <a className="btn btn-primary btn-block btn-lg" href={`/api/documents/${b.apk.id}?download`}>
                  <Icon name="download" /> Download for Android ({fmtBytes(b.apk.size_bytes)})
                </a>
              )}
              {b.android_url && <a className="btn btn-primary btn-block btn-lg" href={b.android_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open Android test link</a>}
              {b.ios_url && <a className="btn btn-primary btn-block btn-lg" href={b.ios_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open in TestFlight (iPhone)</a>}
              {b.test_url && <a className="btn btn-block btn-lg" href={b.test_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open test link</a>}
              <details className="small muted">
                <summary style={{ cursor: "pointer" }}>How do I install it?</summary>
                <ul style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                  {b.apk && <li><strong>Android APK:</strong> open this page on your Android phone, tap Download, open the file and allow “Install unknown apps” for your browser when asked.</li>}
                  {b.ios_url && <li><strong>iPhone:</strong> install Apple&apos;s free TestFlight app, then open the TestFlight link on your iPhone and tap Accept → Install.</li>}
                  {b.android_url && <li><strong>Android link:</strong> open it on your phone while signed in to Google Play with the email you gave us.</li>}
                  {b.test_url && <li><strong>Test link:</strong> opens a demo you can try in the browser or in Expo Go.</li>}
                </ul>
              </details>
            </div>
          </Panel>

          {b.notes && <Panel title="What's new / what to test"><p className="muted pre" style={{ margin: 0 }}>{b.notes}</p></Panel>}

          {b.screenshots.length > 0 && (
            <Panel title="Screenshots">
              <div className="phone-gallery">
                {b.screenshots.map((s) => (
                  <a key={s.id} href={`/api/documents/${s.id}`} target="_blank" rel="noopener" className="phone-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/documents/${s.id}`} alt={s.name} loading="lazy" />
                  </a>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Feedback on this version" sub="Shared with the Infinity Web & Apps team.">
            <CommentList comments={b.comments} />
            {b.clientScreenshots.length > 0 && <div className="row" style={{ flexWrap: "wrap", margin: "6px 0" }}>{b.clientScreenshots.map((s) => <a key={s.id} className="btn btn-sm" href={`/api/documents/${s.id}`} target="_blank" rel="noopener"><Icon name="eye" /> {s.name}</a>)}</div>}
            <CommentForm projectId={projectId} targetType="app_build" targetId={b.id} placeholder="Ask a question or add a comment…" />
          </Panel>
        </div>

        <div className="stack">
          {open && <Panel title="Your review"><AppBuildReview buildId={b.id} version={b.version_no} /></Panel>}
          {b.status === "approved" && <div className="notice success">You approved this version{b.reviewed_at ? ` on ${fmtDate(b.reviewed_at)}` : ""}.</div>}
          <Panel title="Version history">
            <div className="list">
              {builds.map((x) => (
                <Link key={x.id} href={`?v=${x.id}`} className="list-item" style={x.id === b.id ? { background: "rgba(61,139,255,.08)" } : undefined}>
                  <div className="grow"><div className="small" style={{ fontWeight: 500 }}>Version {x.version_no}{x.build_label ? ` · ${x.build_label}` : ""}</div><div className="tiny faint">{fmtDate(x.published_at)}</div></div>
                  <PreviewBadge status={x.status} />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
