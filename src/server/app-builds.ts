import { z } from "zod";
import { withDb, assertAdmin, audit, getProjectFor, asSystem, type Actor, type Tx } from "./core";
import { parse, optText } from "./validate";
import { notifyAdmins, notifyProjectClients } from "./notify";
import { listComments, MAX_UPLOAD_BYTES } from "./content";
import { sendEmail } from "./delivery";
import { AppError, notFound } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { appUrl, company } from "@/lib/config";

// ---------------------------------------------------------------------------
// Mobile app builds: published by an admin, tested and reviewed by the client.
// ---------------------------------------------------------------------------
export type UploadFile = { name: string; type: string; data: Buffer };
export const MAX_SCREENSHOTS = 8;
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;
const APK_MIME = "application/vnd.android.package-archive";

const httpsUrl = (label: string) => z.string().trim().max(2000).optional().nullable().transform((v) => v || null)
  .refine((v) => !v || /^https:\/\/[^\s]+$/i.test(v), `${label} must be an https:// link`);

const publishSchema = z.object({
  platform: z.enum(["android", "ios", "both"]),
  build_label: optText(60),
  notes: optText(5000),
  android_url: httpsUrl("The Android link"),
  ios_url: httpsUrl("The TestFlight link"),
  test_url: z.string().trim().max(2000).optional().nullable().transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), "The test link must start with http:// or https://"),
});

const safeName = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255) || "file";

function checkImages(files: UploadFile[], max: number) {
  const shots = files.filter((f) => f.data.length > 0);
  if (shots.length > max) throw new AppError(`You can attach up to ${max} screenshots.`);
  for (const f of shots) {
    if (!IMAGE_MIME.test((f.type || "").toLowerCase())) throw new AppError(`${f.name} is not a PNG, JPEG, WebP or GIF image.`);
    if (f.data.length > MAX_UPLOAD_BYTES) throw new AppError(`${f.name} is larger than 15 MB.`);
  }
  return shots;
}

async function attach(tx: Tx, actor: Actor, projectId: string, buildId: string, f: UploadFile, category: "app_build" | "screenshot", mime: string) {
  const name = safeName(f.name);
  const [doc] = await tx<{ id: string }[]>`
    insert into documents (project_id, category, name, mime_type, size_bytes, sha256, visibility, app_build_id, uploaded_by)
    values (${projectId}, ${category}, ${name}, ${mime}, ${f.data.length}, ${sha256(f.data)}, 'client', ${buildId}, ${actor.userId}) returning id`;
  await tx`insert into document_blobs (document_id, data) values (${doc.id}, ${f.data})`;
  return doc.id;
}

export async function publishAppBuild(actor: Actor, projectId: string, input: unknown, files: { apk?: UploadFile | null; screenshots?: UploadFile[] } = {}) {
  assertAdmin(actor);
  const d = parse(publishSchema, input);
  const apk = files.apk && files.apk.data.length > 0 ? files.apk : null;
  if (apk) {
    if (!/\.apk$/i.test(apk.name)) throw new AppError("The Android file must be an .apk.");
    if (apk.data.length > MAX_UPLOAD_BYTES) throw new AppError("The APK is larger than 15 MB. Upload it to Google Drive or Firebase App Distribution and paste the link instead.");
    // APKs are ZIP archives.
    if (apk.data.length < 4 || apk.data.readUInt32LE(0) !== 0x04034b50) throw new AppError("That file doesn't look like a valid APK.");
  }
  const shots = checkImages(files.screenshots ?? [], MAX_SCREENSHOTS);
  if (!apk && !d.android_url && !d.ios_url && !d.test_url) {
    throw new AppError("Add at least one way to test: an APK, an Android link, a TestFlight link or a test/demo link.");
  }
  const result = await withDb(actor, async (tx) => {
    const project = await getProjectFor(tx, actor, projectId);
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(version_no), 0) + 1 as next from app_builds where project_id = ${projectId}`;
    await tx`update app_builds set status = 'superseded' where project_id = ${projectId} and status in ('ready_for_review', 'changes_requested')`;
    const [b] = await tx<{ id: string }[]>`
      insert into app_builds (project_id, version_no, platform, build_label, notes, android_url, ios_url, test_url, published_by)
      values (${projectId}, ${next}, ${d.platform}, ${d.build_label}, ${d.notes}, ${d.android_url}, ${d.ios_url}, ${d.test_url}, ${actor.userId})
      returning id`;
    if (apk) await attach(tx, actor, projectId, b.id, apk, "app_build", APK_MIME);
    for (const s of shots) await attach(tx, actor, projectId, b.id, s, "screenshot", s.type.toLowerCase());
    await audit(tx, actor, "app_build.published", "app_build", b.id, projectId,
      { version: next, platform: d.platform, build: d.build_label, apk: !!apk, screenshots: shots.length });
    const title = `App build v${next}${d.build_label ? ` (${d.build_label})` : ""} is ready to test`;
    await tx`insert into project_updates (project_id, author_id, kind, title, body)
             values (${projectId}, ${actor.userId}, 'testing', ${title}, ${d.notes})`;
    await notifyProjectClients(tx, actor, projectId, { type: "app_build_ready", title, link: `/portal/${projectId}/app` });
    const members = await tx<{ email: string; name: string }[]>`
      select u.email, u.name from project_members m join users u on u.id = m.user_id
      where m.project_id = ${projectId} and u.role = 'client' and u.disabled_at is null`;
    return { id: b.id, version: next, title, members, projectName: project.name };
  });
  // Email outside the transaction; delivery results are logged and never block publishing.
  for (const m of result.members) {
    await sendEmail({
      to: m.email, purpose: "app_build", projectId,
      subject: `${result.title} — ${result.projectName}`,
      text: `Hi ${m.name},\n\nA new version of your app (${result.projectName}) is ready for you to test.\n\nOpen it here: ${appUrl()}/portal/${projectId}/app\n\nInstall it, try it out, then approve it or tell us what to change from the same page.\n\nThank you,\n${company().name}`,
    }).catch((e) => console.error("[app build email]", e));
  }
  return result.id;
}

const reviewSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: optText(10000),
  device: optText(120),
  confirm: z.coerce.boolean().optional().default(false),
});

/** The client approves a build or requests changes (optionally with screenshots of the problem). */
export async function reviewAppBuild(actor: Actor, buildId: string, input: unknown, screenshots: UploadFile[] = []) {
  if (actor.role !== "client") throw new AppError("Only the client can review an app build.");
  const d = parse(reviewSchema, input);
  if (d.decision === "changes_requested" && !d.note) throw new AppError("Please describe what you would like us to change.");
  if (d.decision === "approved" && !d.confirm) throw new AppError("Please confirm that you have tested this version and approve it.");
  const shots = checkImages(screenshots, 5);
  return withDb(actor, async (tx) => {
    const [b] = await tx<{ id: string; project_id: string; status: string; version_no: number }[]>`
      select id, project_id, status, version_no from app_builds where id = ${buildId}`;
    if (!b) throw notFound("App build not found.");
    await getProjectFor(tx, actor, b.project_id);
    if (b.status !== "ready_for_review" && b.status !== "changes_requested") throw new AppError("This version is no longer open for review.");
    await asSystem(tx, actor, () => tx`update app_builds set status = ${d.decision}, reviewed_by = ${actor.userId}, reviewed_at = now() where id = ${buildId}`);
    const body = [d.decision === "approved" ? `Approved version ${b.version_no}.` : null, d.device ? `Tested on: ${d.device}` : null, d.note].filter(Boolean).join("\n");
    await tx`insert into comments (project_id, target_type, target_id, author_id, body)
             values (${b.project_id}, 'app_build', ${buildId}, ${actor.userId}, ${body})`;
    for (const s of shots) await attach(tx, actor, b.project_id, buildId, s, "screenshot", s.type.toLowerCase());
    await audit(tx, actor, "app_build.reviewed", "app_build", buildId, b.project_id, { decision: d.decision, version: b.version_no, device: d.device, screenshots: shots.length });
    await notifyAdmins(tx, actor, {
      type: "client_feedback", projectId: b.project_id, link: `/admin/projects/${b.project_id}/app-builds`,
      title: `${actor.name} ${d.decision === "approved" ? "approved" : "requested changes on"} app build v${b.version_no}`, body: d.note,
    });
  });
}

export type AppBuild = {
  id: string; version_no: number; platform: "android" | "ios" | "both"; build_label: string | null; notes: string | null;
  android_url: string | null; ios_url: string | null; test_url: string | null; status: string; published_at: Date; reviewed_at: Date | null;
  reviewer_name: string | null;
};

export async function listAppBuilds(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const builds = await tx<AppBuild[]>`
      select b.*, u.name as reviewer_name from app_builds b left join users u on u.id = b.reviewed_by
      where b.project_id = ${projectId} order by b.version_no desc`;
    const comments = await listComments(tx, projectId, "app_build");
    const files = await tx<{ id: string; app_build_id: string; category: string; name: string; size_bytes: number; uploader_role: string | null }[]>`
      select d.id, d.app_build_id, d.category, d.name, d.size_bytes, u.role as uploader_role
      from documents d left join users u on u.id = d.uploaded_by
      where d.project_id = ${projectId} and d.app_build_id is not null order by d.created_at`;
    return builds.map((b) => {
      const mine = files.filter((f) => f.app_build_id === b.id);
      return {
        ...b,
        comments: comments.filter((c) => c.target_id === b.id),
        apk: mine.find((f) => f.category === "app_build") ?? null,
        screenshots: mine.filter((f) => f.category === "screenshot" && f.uploader_role !== "client"),
        clientScreenshots: mine.filter((f) => f.category === "screenshot" && f.uploader_role === "client"),
      };
    });
  });
}

/** Remove a build that was published by mistake (and its files). Approved builds are kept for the record. */
export async function deleteAppBuild(actor: Actor, buildId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [b] = await tx<{ project_id: string; version_no: number; status: string }[]>`select project_id, version_no, status from app_builds where id = ${buildId}`;
    if (!b) throw notFound();
    if (b.status === "approved") throw new AppError("Approved versions are kept as a record and cannot be deleted.");
    await tx`delete from comments where target_type = 'app_build' and target_id = ${buildId}`;
    await tx`delete from app_builds where id = ${buildId}`;
    await audit(tx, actor, "app_build.deleted", "app_build", buildId, b.project_id, { version: b.version_no });
  });
}

/** For the Settings page: links built from APP_URL only work for clients if it is the public production address. */
export function appUrlWarning(): string | null {
  const u = appUrl();
  if (/localhost|127\.0\.0\.1/.test(u)) return process.env.NODE_ENV === "production" ? "APP_URL points to localhost, so links in emails won't open for clients." : null;
  if (!u.startsWith("https://")) return "APP_URL should start with https://.";
  // Vercel deployment/preview URLs look like <project>-<hash>-<team>.vercel.app or <project>-git-<branch>-<team>.vercel.app.
  if (/\.vercel\.app$/.test(new URL(u).host) && /-git-|-[a-z0-9]{9}-/.test(new URL(u).host)) {
    return "APP_URL looks like a Vercel preview/deployment link. Those ask clients to log in to Vercel. Use your production domain instead (e.g. https://your-project.vercel.app or your own domain).";
  }
  return null;
}

