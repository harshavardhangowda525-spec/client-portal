import { test, expect, type Page } from "@playwright/test";

/**
 * Maintenance expiry & billing through the real UI: payment details → free period ends → client opts in
 * with explicit consent → monthly invoice → client scans the UPI QR and reports the payment → admin confirms.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const stamp = Date.now().toString(36);

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
const ist = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

test("maintenance expiry, opt-in and UPI payment", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();

  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  // Payment details with QR preview
  await admin.goto("/admin/settings/maintenance");
  await admin.getByLabel("UPI ID").fill("infinity@okhdfcbank");
  await admin.getByLabel("Payee name (shown in UPI apps)").fill("Infinity Web & Apps");
  await admin.getByLabel("IFSC").fill("HDFC0001234");
  await admin.getByLabel("Account number").fill("50100123456789");
  await admin.getByRole("button", { name: "Save payment details" }).click();
  await expect(admin.getByText("Payment details saved.")).toBeVisible();
  await expect(admin.locator(".qr-box svg")).toBeVisible();
  await shot(admin, "m01-admin-payment-settings");

  // Client + project + quotation (starts the free period) + invitation
  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`Spice Route ${stamp}`);
  await admin.getByLabel("Owner name").fill("Arjun Rao");
  await admin.getByLabel("Email").fill(`arjun-${stamp}@example.test`);
  await admin.getByLabel("Phone / WhatsApp").fill("9876501234");
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = admin.url();
  await admin.getByLabel("Project name").fill("Restaurant Website");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectId = admin.url().split("/").pop()!;
  await admin.goto(`/admin/projects/${projectId}/quotations`);
  await admin.getByRole("button", { name: "Create draft" }).click();
  await expect(admin.getByRole("heading", { name: "Draft quotation" })).toBeVisible();
  await admin.goto(clientUrl);
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const inviteLink = (await admin.locator("code").filter({ hasText: "/invite/" }).textContent())!.trim();

  // The project is tracked automatically from today; simulate a free period that ended today.
  await admin.goto(`/admin/maintenance/${projectId}`);
  await expect(admin.getByText(/day\(s\) left/)).toBeVisible();
  await admin.getByLabel("Free maintenance expiry").fill(ist(0));
  await admin.getByLabel("Free maintenance start").fill(ist(-182));
  await admin.getByLabel("Note for the history (optional)").fill("E2E: simulate expiry");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByText("Maintenance details updated.")).toBeVisible();
  await admin.goto("/admin/maintenance");
  await admin.getByRole("button", { name: "Run check now" }).click();
  await expect(admin.getByText(/Checked \d+ project/)).toBeVisible();
  await admin.goto(`/admin/maintenance/${projectId}`);
  await expect(admin.getByText("Free maintenance has ended (client)").or(admin.getByText("Free maintenance ended (client)")).first()).toBeVisible();
  await shot(admin, "m02-admin-maintenance-detail");

  // Client: expiry notice, explicit opt-in
  await client.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ""));
  await client.getByLabel("Create a password").fill("SpiceRoute2026");
  await client.getByLabel("Confirm password").fill("SpiceRoute2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);
  await client.goto(`/portal/${projectId}/maintenance`);
  await expect(client.getByText(/Your six-month free maintenance period has ended. Continue with our maintenance plan for ₹500/)).toBeVisible();
  await expect(client.getByText("Hosting and domain renewal")).toHaveCount(0);
  await shot(client, "m03-client-expired");
  await client.getByLabel(/I have read what maintenance includes/).check();
  await client.getByLabel(/I agree to pay/).check();
  await client.getByLabel("Type your full name to confirm").fill("Arjun Rao");
  await client.getByRole("button", { name: "Activate maintenance plan" }).click();
  await expect(client.getByText("Paid maintenance activated. Thank you!")).toBeVisible();
  await expect(client.getByText("Your maintenance plan")).toBeVisible();

  // First invoice issued immediately; pay by UPI QR and report the UTR
  const row = client.locator("tr").filter({ hasText: "INV-" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Pay" }).click();
  const dialog = client.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: /UPI QR code/ })).toBeVisible();
  await expect(dialog.getByText("infinity@okhdfcbank")).toBeVisible();
  await shot(client, "m04-client-pay-qr");
  await dialog.getByLabel("UTR / transaction ID").fill("412345678901");
  await dialog.getByRole("button", { name: "I've paid" }).click();
  await expect(client.getByText(/We'll confirm your payment shortly/)).toBeVisible();
  await expect(client.getByText("Payment reported")).toBeVisible();
  await expect(client.getByText("Awaiting client").or(client.getByText("Paid maintenance")).first()).toBeVisible();

  // Admin confirms after checking the bank
  await admin.goto(`/admin/maintenance/${projectId}`);
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Confirm" }).click();
  await expect(admin.getByText("Payment marked confirmed.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByText("Paid maintenance").first()).toBeVisible();

  await client.reload();
  await expect(client.getByText("Paid maintenance").first()).toBeVisible();
  await expect(client.getByRole("link", { name: "Receipt" })).toBeVisible();
  await shot(client, "m05-client-paid");
});
