import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * Growth portal acceptance flow through the real UI (desktop admin + phone-sized client):
 * dashboard quick actions → light theme → UPI scanner pop-up → Review Studio → services + upgrade request →
 * AI advisor (rule-based fallback) → book a meeting → admin sees the opportunity, meeting and growth dashboard.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const DB = process.env.DATABASE_URL ?? "postgres://portal_owner:portal_owner@localhost:5432/portal";
const stamp = Date.now().toString(36);
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }

test("growth portal: dashboard → UPI scanner → review studio → services → advisor → meeting → admin growth", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();

  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  // Calendar open every day; UPI payee set.
  await admin.goto("/admin/referrals/calls");
  for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) await admin.getByLabel(d).fill("09:00-21:00");
  await admin.getByLabel("Minimum notice (hours)").fill("1");
  await admin.getByRole("button", { name: "Save availability" }).click();
  await expect(admin.getByText("Calendar saved.")).toBeVisible();
  const sql = postgres(DB, { max: 1, onnotice: () => {} });
  await sql.begin(async (tx) => {
    await tx`select set_config('app.role', 'system', true)`;
    await tx`update app_settings set value = value || '{"upi_id": "9980801231@ybl", "payee_name": "Infinity Web & Apps"}' where key = 'payment_details'`;
  });

  // Client + project + signup
  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`Sharma Physio ${stamp}`);
  await admin.getByLabel("Owner name").fill("Priya Sharma");
  await admin.getByLabel("Email").fill(`priya-${stamp}@example.test`);
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = admin.url();
  const clientId = clientUrl.split("/").pop()!;
  await sql.begin(async (tx) => { await tx`select set_config('app.role', 'system', true)`; await tx`update client_profiles set business_category = 'Physiotherapy clinic' where id = ${clientId}`; });
  await admin.getByLabel("Project name").fill("Clinic Website");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = admin.url();
  const projectId = projectUrl.split("/").pop()!;
  await admin.goto(clientUrl);
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const invite = (await admin.locator("code").filter({ hasText: "/invite/" }).textContent())!.trim();
  await client.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await client.getByLabel("Create a password").fill("SharmaPhysio2026");
  await client.getByLabel("Confirm password").fill("SharmaPhysio2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(new RegExp(`/portal/${projectId}$`));

  // An invoice to pay and a preview to review (created by the admin's tools in the DB for speed).
  await sql.begin(async (tx) => {
    await tx`select set_config('app.role', 'system', true)`;
    await tx`insert into invoices (project_id, number, title, amount, status, issued_at, due_date) values (${projectId}, ${`INV-E2E-${stamp}`}, 'Development start', 36000, 'issued', now(), current_date + 10)`;
    await tx`insert into previews (project_id, version_no, url, title, status) values (${projectId}, 1, 'https://example.com', 'Homepage design', 'ready_for_review')`;
  });

  // 1. Dashboard: next step, quick actions, bottom tab bar, light theme.
  await client.reload();
  await expect(client.getByRole("heading", { name: "Quick actions" })).toBeVisible();
  await expect(client.getByRole("link", { name: "Refer a business" }).first()).toBeVisible();
  await expect(client.getByRole("navigation", { name: "Quick navigation" })).toBeVisible();
  await client.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(client.locator("html")).toHaveAttribute("data-theme", "light");
  await client.reload();
  await expect(client.locator("html")).toHaveAttribute("data-theme", "light"); // remembered across visits
  await shot(client, "g01-client-dashboard-light");

  // 2. UPI scanner pop-up from the dashboard's payment card.
  await client.getByRole("button", { name: "Pay by UPI" }).first().click();
  const dialog = client.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: /UPI QR code/ })).toBeVisible();
  await expect(dialog.locator(".scanner.is-ready")).toBeVisible();
  await expect(dialog.getByText("9980801231@ybl")).toBeVisible();
  const openApp = dialog.locator('a[href^="upi://pay"]');
  await expect(openApp).toHaveText("Open UPI app on this phone");
  await expect(openApp).toHaveAttribute("href", /^upi:\/\/pay\?pa=9980801231%40ybl&pn=Infinity%20Web%20%26%20Apps&am=36000\.00/);
  await shot(client, "g02-upi-scanner");
  await dialog.getByRole("button", { name: /I've paid — send the reference/ }).click();
  await dialog.getByLabel("UTR / transaction ID").fill("512345678901");
  await dialog.getByRole("button", { name: "I've paid", exact: true }).click();
  await expect(client.getByText(/We'll confirm your payment shortly|confirm/).first()).toBeVisible();

  // 3. Review Studio: approval steps, viewport switch, approve.
  await client.goto(`/portal/${projectId}/preview`);
  await expect(client.getByRole("list", { name: "Approval status" })).toBeVisible();
  await client.getByRole("button", { name: /Mobile/ }).click();
  await expect(client.locator("iframe.frame")).toHaveAttribute("data-device", "mobile");
  await client.getByRole("button", { name: "Approve this version" }).click();
  await client.getByRole("button", { name: "Confirm approval" }).click();
  await expect(client.getByText(/You approved this version/)).toBeVisible();

  // 4. Services: personalised suggestion + upgrade request.
  await client.goto("/portal/services");
  await expect(client.getByText(/Picked for your physiotherapy clinic business/)).toBeVisible();
  const card = client.locator("article").filter({ hasText: "AI receptionist" });
  await card.getByRole("button", { name: "Request upgrade" }).click();
  await client.getByRole("dialog").getByLabel(/What would you like it to do/).fill("Answer calls while we treat patients");
  await client.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
  await expect(card.getByText(/Requested · Received/)).toBeVisible();
  await shot(client, "g03-services");

  // 5. AI advisor (mock AI returns nothing usable → rule-based answer), then consultation request.
  await client.goto("/portal/advisor");
  await client.getByLabel("Your message").fill("We miss appointment calls during sessions");
  await client.getByRole("button", { name: "Send" }).click();
  await expect(client.locator(".advisor-ai").filter({ hasText: "These services could help" })).toBeVisible();
  await client.getByRole("button", { name: "Request a consultation" }).click();
  await expect(client.getByText(/Sent to our team/).first()).toBeVisible();

  // 6. Meetings: pick a slot and book.
  await client.goto("/portal/meetings");
  await client.locator(".day-btn").nth(1).click();
  await client.locator(".slot").first().click();
  await client.getByRole("button", { name: "Confirm booking" }).click();
  await expect(client.getByText(/You're booked/)).toBeVisible();
  await expect(client.getByRole("link", { name: "Reschedule" })).toBeVisible();
  await shot(client, "g04-meetings");

  // 7. Admin: upgrade request + advisor opportunities, client meeting, growth dashboard.
  await admin.goto("/admin/services");
  await expect(admin.locator("tr").filter({ hasText: `Sharma Physio ${stamp}` }).filter({ hasText: "AI receptionist" }).first()).toBeVisible();
  await admin.goto("/admin/referrals/calls");
  await expect(admin.getByText(`Sharma Physio ${stamp}`).first()).toBeVisible();
  await expect(admin.getByText(/Client meeting/).first()).toBeVisible();
  await admin.goto("/admin/growth");
  await expect(admin.getByRole("heading", { name: "Revenue & growth" })).toBeVisible();
  await expect(admin.getByText("Upgrade requests").first()).toBeVisible();
  await expect(admin.getByRole("link", { name: new RegExp(`Sharma Physio ${stamp}`) }).first()).toBeVisible();
  await shot(admin, "g05-admin-growth");

  // 8. Public showcase page loads without signing in.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/showcase");
  await expect(anon.getByRole("heading", { name: /Work we're proud of/ })).toBeVisible();
  await sql.end();
});
