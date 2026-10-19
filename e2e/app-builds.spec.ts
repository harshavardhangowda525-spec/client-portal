import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** App build review: admin publishes a build, the client follows a deep link through sign-in, tests and approves. */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const stamp = Date.now().toString(36);
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }

// 1×1 PNG and a minimal ZIP-signature "APK".
const dir = mkdtempSync(path.join(tmpdir(), "appbuild-"));
const pngPath = path.join(dir, "home.png");
writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const apkPath = path.join(dir, "app-release.apk");
writeFileSync(apkPath, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 7)]));

test("app build review through the client portal", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();

  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`FitTrack ${stamp}`);
  await admin.getByLabel("Owner name").fill("Meera Iyer");
  await admin.getByLabel("Email").fill(`meera-${stamp}@example.test`);
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = admin.url();
  await admin.getByLabel("Project name").fill("FitTrack Mobile App");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectId = admin.url().split("/").pop()!;

  // Client account first, then sign out so we can test the deep link.
  await admin.goto(clientUrl);
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const invite = (await admin.locator("code").filter({ hasText: "/invite/" }).textContent())!.trim();
  await client.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await client.getByLabel("Create a password").fill("FitTrack2026");
  await client.getByLabel("Confirm password").fill("FitTrack2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);
  await client.goto(`/portal/${projectId}/app`);
  await expect(client.getByText("Your app isn't ready to test yet")).toBeVisible();
  await client.context().clearCookies();

  // Admin publishes v1.
  await admin.goto(`/admin/projects/${projectId}/app-builds`);
  await admin.getByLabel("Platform").selectOption("both");
  await admin.getByLabel("Version / build").fill("1.0.0 (1)");
  await admin.getByLabel("Android APK file").setInputFiles(apkPath);
  await admin.getByLabel("TestFlight link").fill("https://testflight.apple.com/join/AbCdEf");
  await admin.getByLabel("Screenshots (up to 8)").setInputFiles([pngPath]);
  await admin.getByLabel(/What's new/).fill("Workout tracking and login. Please test sign-up.");
  await admin.getByRole("button", { name: "Publish build" }).click();
  await expect(admin.getByText("App build published and the client was notified.")).toBeVisible();
  await expect(admin.getByText("Version 1 · 1.0.0 (1)")).toBeVisible();
  await shot(admin, "a01-admin-app-builds");

  // Deep link (as sent by email) → sign-in → straight back to the App review page.
  await client.goto(`/portal/${projectId}/app`);
  await expect(client).toHaveURL(/\/login\?next=/);
  await client.getByLabel("Email").fill(`meera-${stamp}@example.test`);
  await client.getByLabel("Password").fill("FitTrack2026");
  await client.getByRole("button", { name: "Sign in" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${projectId}/app$`));
  await expect(client.getByRole("link", { name: /Download for Android/ })).toBeVisible();
  await expect(client.getByRole("link", { name: /Open in TestFlight/ })).toHaveAttribute("href", "https://testflight.apple.com/join/AbCdEf");
  await expect(client.locator(".phone-frame img")).toHaveCount(1);
  await shot(client, "a02-client-app-review");

  // APK download works for the client.
  const [download] = await Promise.all([client.waitForEvent("download"), client.getByRole("link", { name: /Download for Android/ }).click()]);
  expect(download.suggestedFilename()).toBe("app-release.apk");

  // Request changes, then approve the next build.
  await client.getByRole("button", { name: "Request changes" }).click();
  await client.getByLabel(/Phone you tested on/).fill("Redmi Note 12");
  await client.getByLabel("What should we change?").fill("Sign-up button does nothing.");
  await client.getByLabel(/Screenshots of the problem/).setInputFiles([pngPath]);
  await client.getByRole("button", { name: "Send feedback" }).click();
  await expect(client.getByText("Your feedback was sent to the team.")).toBeVisible();
  await expect(client.getByText(/Tested on: Redmi Note 12/)).toBeVisible();

  await admin.reload();
  await expect(admin.getByText(/Sign-up button does nothing/)).toBeVisible();
  await expect(admin.getByRole("link", { name: /Client screenshot/ })).toBeVisible();
  await admin.getByLabel("Android link").fill("https://drive.google.com/file/d/xyz/view");
  await admin.getByLabel("Version / build").fill("1.0.1 (2)");
  await admin.getByRole("button", { name: "Publish build" }).click();
  await expect(admin.getByText("Version 2 · 1.0.1 (2)")).toBeVisible();

  await client.reload();
  await expect(client.getByRole("heading", { name: "Version 2 · 1.0.1 (2)" })).toBeVisible();
  await client.getByRole("button", { name: "Approve this build" }).click();
  await client.getByLabel(/I have tested version 2/).check();
  await client.getByRole("button", { name: "Confirm approval" }).click();
  await expect(client.getByText("App build approved. Thank you!")).toBeVisible();
  await expect(client.getByText(/You approved this version/)).toBeVisible();
  await shot(client, "a03-client-approved");
});
