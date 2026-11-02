import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Infinity Resolve end to end. Needs the app running with GROQ_BASE_URL pointing at e2e/mock-groq.mjs
 * (set E2E_GROQ_MOCK=1). Real Groq is never called from tests.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const stamp = Date.now().toString(36);
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }
const dir = mkdtempSync(path.join(tmpdir(), "resolve-"));
const png = path.join(dir, "shot.png");
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC", "base64"));

test.skip(process.env.E2E_GROQ_MOCK !== "1", "needs the app running against e2e/mock-groq.mjs");

test("client request: AI clarification → confirmation → admin briefing, action items and resolution", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.goto("/admin/resolve/settings");
  await admin.getByLabel("Administrator email").fill("owner@infinity.test");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await expect(admin.getByText("Settings saved.")).toBeVisible();

  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`Tandoor House ${stamp}`);
  await admin.getByLabel("Owner name").fill("Ravi Kumar");
  await admin.getByLabel("Email").fill(`ravi-${stamp}@example.test`);
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  await admin.getByLabel("Project name").fill("Restaurant Website");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectId = admin.url().split("/").pop()!;
  await admin.goBack();
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const invite = (await admin.locator("code").filter({ hasText: "/invite/" }).textContent())!.trim();
  await client.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await client.getByLabel("Create a password").fill("Tandoor2026");
  await client.getByLabel("Confirm password").fill("Tandoor2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);

  // --- Client: ask the assistant
  await client.goto(`/portal/${projectId}/resolve`);
  await expect(client.getByRole("heading", { name: "Infinity Resolve" })).toBeVisible();
  await client.getByLabel("What do you need?").fill("I want to change the homepage.");
  await client.getByRole("button", { name: "Send", exact: true }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${projectId}/resolve/[0-9a-f-]{36}$`));
  await expect(client.getByText(/Which section of the homepage/)).toBeVisible();
  await client.getByLabel("Your answer").fill("The hero section — please use our new photo.");
  await client.getByRole("button", { name: "Send", exact: true }).click();
  await expect(client.getByRole("heading", { name: "Is this right?" })).toBeVisible();
  await expect(client.getByText(/Replace the homepage hero background image/)).toBeVisible();
  await shot(client, "r01-client-summary");
  await client.getByRole("button", { name: /Yes, this is correct/ }).click();
  await expect(client.getByText(/Request confirmed and sent to the Infinity Web & Apps team/)).toBeVisible();
  const ticketUrl = client.url();

  // --- Admin: ticket, briefing, action items
  await admin.goto("/admin/resolve");
  await admin.getByRole("link", { name: "Update homepage hero image" }).first().click();
  await expect(admin.getByText("Confirmed by the client")).toBeVisible();
  await expect(admin.getByText(/Which section of the homepage/)).toBeVisible();
  await expect(admin.getByText("Check the client's new photo")).toBeVisible(); // action item from the briefing
  await expect(admin.locator(".badge", { hasText: /^ticket$/ })).toBeVisible();
  await shot(admin, "r02-admin-ticket");
  await admin.getByRole("textbox", { name: "Message" }).fill("Internal: use the 4K version");
  await admin.getByRole("button", { name: "Add internal note" }).click();
  await expect(admin.getByText("Internal note added.")).toBeVisible();
  await admin.getByLabel("Assign to").selectOption({ index: 1 });
  await admin.getByLabel("Status").selectOption("awaiting_client_verification");
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  await expect(admin.getByText("Ticket updated.")).toBeVisible();
  await admin.goto("/admin/resolve/briefings");
  await expect(admin.getByText(/Client Briefing — Ravi Kumar/).first()).toBeVisible();
  await shot(admin, "r03-admin-briefings");

  // --- Client: never sees the internal note; verifies the fix
  await client.goto(ticketUrl);
  await expect(client.getByText("Internal: use the 4K version")).toHaveCount(0);
  await expect(client.getByRole("heading", { name: "Is it fixed?" })).toBeVisible();
  await client.getByRole("button", { name: "Yes, it's resolved" }).click();
  await expect(client.getByText("Thanks for confirming!")).toBeVisible();
  await expect(client.getByText("Resolved").first()).toBeVisible();

  // --- Visual feedback with an annotated screenshot
  await client.goto(`/portal/${projectId}/resolve?tab=visual`);
  await client.getByLabel("Upload screenshot").setInputFiles(png);
  const canvas = client.getByLabel(/Screenshot — draw/);
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await client.mouse.move(box.x + 20, box.y + 20); await client.mouse.down(); await client.mouse.move(box.x + 120, box.y + 80); await client.mouse.up();
  await expect(client.getByText("1 mark(s)")).toBeVisible();
  await client.getByLabel("Section (optional)").fill("Hero");
  await client.getByLabel("What should change?").fill("Make the hero text bigger");
  await shot(client, "r04-client-visual");
  await client.getByRole("button", { name: "Send feedback" }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${projectId}/resolve/[0-9a-f-]{36}$`));
  await expect(client.getByRole("img", { name: /annotated-screenshot/ })).toBeVisible();
});
