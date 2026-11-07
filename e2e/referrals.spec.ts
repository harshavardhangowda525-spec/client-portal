import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * Referral engine acceptance flow through the real UI: project completed → feedback → referral link →
 * prospect landing page → enquiry → booking → lead in the pipeline with attribution → call outcome →
 * proposal builder → referrer sees progress → dashboard counts it. (The payment-verified conversion is
 * covered end to end in tests/referrals.test.ts.)
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const DB = process.env.DATABASE_URL ?? "postgres://portal_owner:portal_owner@localhost:5432/portal";
const stamp = Date.now().toString(36);
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }

test("referral engine: completion → feedback → link → enquiry → booking → pipeline → proposal", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const prospect = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();

  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  // Open the calendar every day so the test doesn't depend on the weekday.
  await admin.goto("/admin/referrals/calls");
  for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) await admin.getByLabel(d).fill("09:00-21:00");
  await admin.getByLabel("Minimum notice (hours)").fill("1");
  await admin.getByRole("button", { name: "Save availability" }).click();
  await expect(admin.getByText("Calendar saved.")).toBeVisible();

  // Client with a project, invited and signed up.
  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`Happy Bakes ${stamp}`);
  await admin.getByLabel("Owner name").fill("Lakshmi Menon");
  await admin.getByLabel("Email").fill(`lakshmi-${stamp}@example.test`);
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = admin.url();
  await admin.getByLabel("Project name").fill("Bakery Website");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = admin.url();
  const projectId = projectUrl.split("/").pop()!;
  await admin.goto(clientUrl);
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const invite = (await admin.locator("code").filter({ hasText: "/invite/" }).textContent())!.trim();
  await client.goto(invite.replace(/^https?:\/\/[^/]+/, ""));
  await client.getByLabel("Create a password").fill("HappyBakes2026");
  await client.getByLabel("Confirm password").fill("HappyBakes2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);

  // 1. Admin completes the project.
  await admin.goto(projectUrl);
  for (const s of ["On hold", "In development", "Completed"]) {
    await admin.locator("#status").selectOption({ label: s });
    await admin.getByRole("button", { name: "Update", exact: true }).click();
    await expect(admin.getByRole("button", { name: "Update", exact: true })).toBeDisabled();
  }

  // 2–4. Client gets the feedback request, rates 5 stars, referral invitation opens.
  await client.reload();
  await expect(client.getByText("Your project is complete!")).toBeVisible();
  await client.getByRole("link", { name: "Share feedback" }).click();
  for (const g of ["Overall satisfaction", "Project quality", "Communication", "Delivery experience", "Overall experience"]) {
    await client.getByRole("radiogroup", { name: g }).getByRole("radio", { name: "5 stars" }).click();
  }
  await client.getByLabel(/Anything you'd like to tell us/).fill("Wonderful team, our new website brings orders every day!");
  await client.getByLabel(/public testimonial/).check();
  await shot(client, "f01-client-feedback");
  await client.getByRole("button", { name: "Send feedback" }).click();
  await expect(client.getByText("Thank you so much for your feedback!").first()).toBeVisible();
  await client.getByRole("link", { name: "Refer a business" }).click();

  // 5. Client creates and shares the link.
  await expect(client.getByRole("heading", { name: "My Referrals" })).toBeVisible();
  await client.getByRole("button", { name: "Create my link" }).click();
  const linkEl = client.locator("code").filter({ hasText: "/r/" });
  await expect(linkEl).toBeVisible();
  const link = (await linkEl.textContent())!.trim();
  await expect(client.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute("href", /wa\.me\/\?text=.*%2Fr%2F/);
  await expect(client.getByRole("img", { name: /QR code/ })).toBeVisible();
  await shot(client, "f02-client-referrals");

  // 6–7. A prospect opens the link and enquires.
  await prospect.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(prospect.getByText("Recommended by one of our clients")).toBeVisible();
  await expect(prospect.getByText("Happy Bakes")).toHaveCount(0); // referrer identity is not exposed
  await shot(prospect, "f03-landing");
  await prospect.getByLabel("Business name").fill(`Chai Corner ${stamp}`);
  await prospect.getByLabel("Your name").fill("Imran Sheikh");
  await prospect.getByLabel("Email", { exact: true }).fill(`imran-${stamp}@example.test`);
  await prospect.getByLabel("What do you need?").selectOption("Online booking or ordering");
  await prospect.getByLabel(/What problem/).fill("We want customers to pre-order chai and snacks online.");
  await prospect.getByLabel(/agree that Infinity/).check();
  await prospect.waitForTimeout(2600); // the bot check needs a human-like delay
  await prospect.getByRole("button", { name: "Request a free consultation" }).last().click();

  // 9. Booking.
  await expect(prospect).toHaveURL(/\/book\/[A-Za-z0-9_-]+\?new=1$/);
  await expect(prospect.getByText(/We've received your enquiry/)).toBeVisible();
  await prospect.getByRole("group", { name: /Choose a time/ }).getByRole("button").first().click();
  await prospect.getByRole("button", { name: "Book this time" }).click();
  await expect(prospect.getByText("Your call is booked")).toBeVisible();
  await shot(prospect, "f04-booked");

  // 8. The lead is in the pipeline with attribution.
  await admin.goto("/admin/referrals/leads");
  await admin.getByRole("link", { name: `Chai Corner ${stamp}` }).first().click();
  await expect(admin.getByText(/Referred by/)).toContainText(`Happy Bakes ${stamp}`);
  await expect(admin.getByText("Discovery call scheduled").first()).toBeVisible();
  // 10. Record the call outcome (simulate the call having taken place).
  const sql = postgres(DB, { max: 1 });
  await sql.begin(async (tx) => {
    await tx`select set_config('app.role', 'system', true)`; // row-level security applies even to the table owner
    await tx`update discovery_calls set starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes'
             where lead_id = (select id from leads where business_name = ${`Chai Corner ${stamp}`}) and status = 'scheduled'`;
  });
  await sql.end();
  await admin.reload();
  await admin.getByLabel("Outcome").selectOption("proposal_requested");
  await admin.getByLabel("Meeting notes").fill("Wants online pre-orders with UPI payments.");
  await admin.getByRole("button", { name: "Record outcome" }).click();
  await expect(admin.getByText("Outcome recorded.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByText("Discovery call completed").first()).toBeVisible();
  await shot(admin, "f05-admin-lead");
  // 11. Proposal builder opens for the prospect (as a client record).
  await admin.getByRole("button", { name: "Create client & proposal" }).click();
  await expect(admin).toHaveURL(/\/admin\/proposals\/new\?client=[0-9a-f-]{36}$/);
  await expect(admin.getByRole("heading", { name: "New proposal" })).toBeVisible();

  // 13. The referrer sees privacy-safe progress.
  await client.goto("/portal/referrals");
  await expect(client.getByText("Enquiry via your link")).toBeVisible();
  await expect(client.getByText("Under review").first()).toBeVisible();
  await expect(client.getByText(`imran-${stamp}@example.test`)).toHaveCount(0);

  // 14. Dashboard counts it.
  await admin.goto("/admin/referrals");
  await expect(admin.getByText("Verified referral enquiries")).toBeVisible();
  await expect(admin.getByRole("link", { name: `Happy Bakes ${stamp}` })).toBeVisible(); // leaderboard
  await shot(admin, "f06-dashboard");

  // Admin feedback review shows the 5-star feedback.
  await admin.goto("/admin/referrals/feedback");
  await expect(admin.getByText(/Wonderful team/).first()).toBeVisible();
  void projectId;
});
