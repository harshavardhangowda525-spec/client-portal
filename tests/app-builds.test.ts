import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawAs, rawSystem } from "./helpers";
import * as AB from "@/server/app-builds";
import * as X from "@/server/content";
import { deleteClient } from "@/server/clients";

// Minimal valid ZIP local-file header so the APK passes the signature check.
const apk = (name = "app-release.apk") => ({ name, type: "application/vnd.android.package-archive", data: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]) });
const png = (name = "home.png") => ({ name, type: "image/png", data: Buffer.from("\x89PNG\r\n\x1a\nfake-image") });

describe("app builds: publish, test, review", () => {
  let admin: Actor; let client: Actor; let projectId: string;
  let other: { client: Actor; projectId: string };
  let v1: string; let v2: string;

  beforeAll(async () => {
    admin = await makeAdmin();
    ({ client, projectId } = await makeClientWithProject(admin, "AppCo"));
    other = await makeClientWithProject(admin, "Rival");
  });

  it("requires at least one way to test and validates links and files", async () => {
    await expect(AB.publishAppBuild(admin, projectId, { platform: "android" })).rejects.toThrow(/at least one way to test/);
    await expect(AB.publishAppBuild(admin, projectId, { platform: "ios", ios_url: "http://testflight.apple.com/join/x" })).rejects.toThrow(/https/);
    await expect(AB.publishAppBuild(admin, projectId, { platform: "android" }, { apk: { ...apk(), name: "app.zip" } })).rejects.toThrow(/\.apk/);
    await expect(AB.publishAppBuild(admin, projectId, { platform: "android" }, { apk: { ...apk(), data: Buffer.from("not a zip at all") } })).rejects.toThrow(/valid APK/);
    await expect(AB.publishAppBuild(admin, projectId, { platform: "android", test_url: "https://demo.test" },
      { screenshots: Array.from({ length: 9 }, (_, i) => png(`s${i}.png`)) })).rejects.toThrow(/up to 8/);
    await expect(AB.publishAppBuild(admin, projectId, { platform: "android", test_url: "https://demo.test" }, { screenshots: [{ name: "x.svg", type: "image/svg+xml", data: Buffer.from("<svg/>") }] }))
      .rejects.toThrow(/not a PNG/);
    await expect(AB.publishAppBuild(client, projectId, { platform: "android", test_url: "https://demo.test" })).rejects.toThrow();
  });

  it("admin publishes v1 with an APK and screenshots; the client sees it and is notified", async () => {
    v1 = await AB.publishAppBuild(admin, projectId, { platform: "both", build_label: "1.0.0 (1)", notes: "First build", ios_url: "https://testflight.apple.com/join/ABC" },
      { apk: apk(), screenshots: [png("home.png"), png("cart.png")] });
    const [b] = await AB.listAppBuilds(client, projectId);
    expect(b.version_no).toBe(1);
    expect(b.status).toBe("ready_for_review");
    expect(b.apk?.name).toBe("app-release.apk");
    expect(b.screenshots).toHaveLength(2);
    const doc = await X.readDocument(client, b.apk!.id);
    expect(doc.mime_type).toBe("application/vnd.android.package-archive");
    const notes = await X.listNotifications(client);
    expect(notes.some((n) => n.type === "app_build_ready" && n.link === `/portal/${projectId}/app`)).toBe(true);
  });

  it("other clients cannot see or review the build or its files", async () => {
    await expect(AB.listAppBuilds(other.client, projectId)).rejects.toThrow(/not found/i);
    await expect(AB.reviewAppBuild(other.client, v1, { decision: "approved", confirm: true })).rejects.toThrow(/not found/i);
    const [b] = await AB.listAppBuilds(client, projectId);
    await expect(X.readDocument(other.client, b.apk!.id)).rejects.toThrow(/not found/i);
    const rows = await rawAs(other.client, (tx) => tx`select id from app_builds where id = ${v1}`);
    expect(rows).toHaveLength(0);
    // Raw SQL as the client cannot change a build's status.
    await rawAs(client, (tx) => tx`update app_builds set status = 'approved' where id = ${v1}`).catch(() => null);
    expect((await AB.listAppBuilds(admin, projectId))[0].status).toBe("ready_for_review");
  });

  it("client requests changes with device and screenshots; admin is notified and can reply", async () => {
    await expect(AB.reviewAppBuild(client, v1, { decision: "changes_requested" })).rejects.toThrow(/describe/);
    await AB.reviewAppBuild(client, v1, { decision: "changes_requested", note: "Cart crashes", device: "Pixel 7" }, [png("crash.png")]);
    const [b] = await AB.listAppBuilds(admin, projectId);
    expect(b.status).toBe("changes_requested");
    expect(b.comments[0].body).toContain("Tested on: Pixel 7");
    expect(b.clientScreenshots.map((s) => s.name)).toEqual(["crash.png"]);
    expect(b.screenshots).toHaveLength(2);
    const adminNotes = await X.listNotifications(admin);
    expect(adminNotes.some((n) => /requested changes on app build v1/.test(n.title))).toBe(true);
    await X.addComment(admin, projectId, { target_type: "app_build", target_id: v1, body: "Fixed in the next build" });
    expect((await AB.listAppBuilds(client, projectId))[0].comments).toHaveLength(2);
  });

  it("a new version supersedes the open one; approval needs explicit confirmation and is recorded", async () => {
    v2 = await AB.publishAppBuild(admin, projectId, { platform: "android", android_url: "https://drive.google.com/file/d/abc" });
    const builds = await AB.listAppBuilds(client, projectId);
    expect(builds.map((b) => [b.version_no, b.status])).toEqual([[2, "ready_for_review"], [1, "superseded"]]);
    await expect(AB.reviewAppBuild(client, v1, { decision: "approved", confirm: true })).rejects.toThrow(/no longer open/);
    await expect(AB.reviewAppBuild(client, v2, { decision: "approved" })).rejects.toThrow(/confirm/);
    await expect(AB.reviewAppBuild(admin, v2, { decision: "approved", confirm: true })).rejects.toThrow(/Only the client/);
    await AB.reviewAppBuild(client, v2, { decision: "approved", confirm: true, device: "Galaxy A54" });
    const [b] = await AB.listAppBuilds(admin, projectId);
    expect(b.status).toBe("approved");
    expect(b.reviewer_name).toBe("AppCo Owner");
    const [log] = await rawSystem((tx) => tx<{ data: { version: number } }[]>`select data from audit_logs where action = 'app_build.reviewed' and entity_id = ${v2}`);
    expect(log.data.version).toBe(2);
    await expect(AB.deleteAppBuild(admin, v2)).rejects.toThrow(/Approved versions/);
  });

  it("admin can delete a mistaken build along with its files", async () => {
    const id = await AB.publishAppBuild(admin, projectId, { platform: "android" }, { apk: apk("oops.apk") });
    const [b] = await AB.listAppBuilds(admin, projectId);
    await AB.deleteAppBuild(admin, id);
    await expect(X.readDocument(admin, b.apk!.id)).rejects.toThrow(/not found/i);
    expect((await AB.listAppBuilds(admin, projectId)).map((x) => x.version_no)).toEqual([2, 1]);
  });

  it("deleting the client removes their app builds", async () => {
    const c = await makeClientWithProject(admin, "GoneApp");
    await AB.publishAppBuild(admin, c.projectId, { platform: "android", test_url: "https://demo.test" }, { screenshots: [png()] });
    await deleteClient(admin, c.clientId, "GoneApp Bistro");
    const rows = await rawSystem((tx) => tx`select id from app_builds where project_id = ${c.projectId}`);
    expect(rows).toHaveLength(0);
  });

  it("flags Vercel preview links in APP_URL", () => {
    const saved = process.env.APP_URL;
    process.env.APP_URL = "https://client-portal-git-main-harsha.vercel.app";
    expect(AB.appUrlWarning()).toMatch(/preview/);
    process.env.APP_URL = "https://client-portal-4f8k2j9xq-harsha.vercel.app";
    expect(AB.appUrlWarning()).toMatch(/preview/);
    process.env.APP_URL = "https://client-portal.vercel.app";
    expect(AB.appUrlWarning()).toBeNull();
    process.env.APP_URL = "https://portal.infinitywebapps.in";
    expect(AB.appUrlWarning()).toBeNull();
    process.env.APP_URL = saved;
  });
});
