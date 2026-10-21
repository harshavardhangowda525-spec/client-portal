import { test, expect, type Page } from "@playwright/test";
import { createProjectProposal } from "./helpers";

/** "View as client": the admin sees the real portal read-only, leaves no trace, and exits back to admin. */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const stamp = Date.now().toString(36);
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }

test("admin views the portal as a client", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const client = await (await browser.newContext()).newPage();
  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`Lotus Spa ${stamp}`);
  await admin.getByLabel("Owner name").fill("Kavya Nair");
  await admin.getByLabel("Email").fill(`kavya-${stamp}@example.test`);
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = admin.url();

  // No portal account yet → the button explains instead.
  await admin.getByRole("button", { name: "View as client" }).click();
  await expect(admin.getByText(/hasn't created their portal account yet/)).toBeVisible();

  await admin.getByLabel("Project name").fill("Spa Booking Website");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = admin.url();
  await createProjectProposal(admin, projectUrl, { send: true });
  await admin.goto(clientUrl);
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const invite = (await admin.locator("code").filter({ hasText: "/invite/" }).textContent())!.trim();
  await client.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await client.getByLabel("Create a password").fill("LotusSpa2026");
  await client.getByLabel("Confirm password").fill("LotusSpa2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);

  // View as client from the project page.
  await admin.goto(projectUrl);
  await admin.getByRole("button", { name: "View as client" }).click();
  await expect(admin).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);
  await expect(admin.getByText(/Viewing as/)).toContainText("Kavya Nair");
  await expect(admin.getByText("Needs your attention")).toBeVisible();
  await shot(admin, "v01-view-as-overview");

  // Open the proposal (normally marks it "viewed") and try to act.
  const portalUrl = admin.url();
  await admin.goto(`${portalUrl}/proposal`);
  await expect(admin).toHaveURL(/\/portal\/proposals\//);
  await expect(admin.locator(".doc .grand")).toBeVisible();
  await admin.goto(portalUrl);
  await admin.getByRole("link", { name: "Messages" }).click();
  await admin.getByRole("textbox").first().fill("This must not be sent");
  await admin.getByRole("button", { name: "Send" }).click();
  await expect(admin.getByText(/viewing the portal as the client \(read-only\)/)).toBeVisible();

  // Admin pages still work as the admin (in another tab, same session) while viewing.
  const tab = await admin.context().newPage();
  await tab.goto(`${projectUrl}/proposal`);
  await expect(tab.getByRole("heading", { name: "Proposals for this project" })).toBeVisible();
  await expect(tab.locator(".badge", { hasText: "Sent" }).first()).toBeVisible();
  await expect(tab.locator(".badge", { hasText: "Viewed" })).toHaveCount(0); // opening it as the client left no trace
  await tab.goto(`${projectUrl}/messages`);
  await expect(tab.getByText("This must not be sent")).toHaveCount(0);
  await tab.close();

  // Exit returns to the client's admin page and ends the view.
  await admin.getByRole("link", { name: "Exit client view" }).first().click();
  await expect(admin).toHaveURL(clientUrl);
  await admin.goto(projectUrl.replace("/admin/projects/", "/portal/"));
  await expect(admin).toHaveURL(/\/admin$/); // back to normal admin: the portal is for clients
  await admin.goto(`${projectUrl}/activity`);
  await expect(admin.getByText("Admin viewed the portal as the client").first()).toBeVisible();
});
