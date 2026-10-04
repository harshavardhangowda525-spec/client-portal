import { test, expect, type Page } from "@playwright/test";

/**
 * Proposal builder through the real UI: pricing configuration → wizard (new client,
 * package + add-on, external cost, maintenance, milestones) → preview → send →
 * invitation → client reviews and accepts → admin links a project → billing baseline.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const stamp = Date.now().toString(36);
const clientEmail = `prop-${stamp}@example.test`;

async function shot(page: Page, name: string, full = true) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
}

test("proposal builder: create, price, send, accept, convert", async ({ browser }) => {
  const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const admin = await adminCtx.newPage();
  await admin.goto("/login");
  await admin.getByLabel("Email").fill(ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(ADMIN_PASSWORD);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  // Pricing configuration shows the seeded packages and their breakdowns balance.
  await admin.goto("/admin/settings/pricing");
  await expect(admin.getByText("Breakdown total ₹4,999.00 = package price ✓")).toBeVisible();
  await expect(admin.getByText("Breakdown total ₹55,000.00 = package price ✓")).toBeVisible();
  await shot(admin, "p01-pricing-config");

  // --- Wizard step 1: new client
  await admin.goto("/admin/proposals/new");
  await admin.getByRole("button", { name: "New client" }).click();
  await admin.getByLabel("Business name").first().fill(`Chai Point ${stamp}`);
  await admin.getByLabel("Owner name").fill("Meera Iyer");
  await admin.getByLabel("Client email").fill(clientEmail);
  await admin.getByLabel("Phone / WhatsApp").fill("9876501234");
  await admin.getByLabel("Project title").fill("Chai Point website");
  await admin.getByLabel("Client requirements").fill("Menu, location, WhatsApp ordering link");
  await admin.getByLabel("Internal notes (never shown to the client)").fill("SECRET-INTERNAL-NOTE");
  await expect(admin.getByText("₹4,999.00").first()).toBeVisible();
  await admin.getByRole("button", { name: "Save & continue" }).click();
  await expect(admin.getByText(/Draft saved · IWA-P-/)).toBeVisible();

  // --- Step 2: website pricing — add 2 extra pages at ₹1,000
  await admin.getByLabel(/Additional page/).first().check();
  await admin.getByLabel("Qty").first().fill("2");
  await admin.getByLabel("Quoted price (₹)").first().fill("1000");
  await expect(admin.locator(".grand").getByText("₹6,999.00")).toBeVisible();
  await shot(admin, "p02-wizard-pricing");
  await admin.getByRole("button", { name: "Save & continue" }).click();
  await expect(admin.getByRole("heading", { name: /Step 3/ })).toBeVisible();
  await admin.getByRole("button", { name: "Save & continue" }).click();

  // --- Step 4: domain billed by us yearly (recurring, not one-time)
  await admin.getByRole("button", { name: "Domain registration and renewal" }).click();
  await admin.getByLabel("Client price (₹)").fill("1200");
  await admin.getByLabel("Who pays the provider").selectOption("agency");
  await admin.getByLabel("Actual provider cost (₹, internal)").fill("777");
  await expect(admin.locator(".grand").getByText("₹6,999.00")).toBeVisible();
  await expect(admin.getByText("₹1,200.00/yr", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "Save & continue" }).click();

  // --- Step 5: website standard maintenance
  await admin.getByLabel(/Website Standard/).check();
  await expect(admin.getByText("₹1,000.00/mo", { exact: true })).toBeVisible();
  await admin.getByRole("button", { name: "Save & continue" }).click();

  // --- Step 6: scope
  await admin.getByLabel("Features included (one per line)").fill("Menu page\nGallery\nWhatsApp ordering link");
  await admin.getByLabel("Estimated delivery timeline").fill("About 2–3 weeks after content is received");
  await admin.getByRole("button", { name: "Save & continue" }).click();

  // --- Step 7: payment milestones
  await admin.getByRole("button", { name: "Use “Two payments”" }).click();
  await expect(admin.getByText(/Milestones total ₹6,999.00 of ₹6,999.00 ✓/)).toBeVisible();
  await shot(admin, "p03-wizard-payment");
  await admin.getByRole("button", { name: "Save & continue" }).click();

  // --- Step 8: review → preview
  await expect(admin.getByText("Ready to preview.")).toBeVisible();
  await admin.getByRole("button", { name: "Save & preview" }).click();
  await expect(admin).toHaveURL(/\/admin\/proposals\/[0-9a-f-]{36}$/);
  const proposalUrl = admin.url();
  const proposalPath = new URL(proposalUrl).pathname;
  await expect(admin.getByText("Preview — this is exactly what the client will see")).toBeVisible();
  await expect(admin.locator(".doc .grand").getByText("₹6,999.00")).toBeVisible();
  await shot(admin, "p04-admin-preview");
  const pdf = await admin.request.get(`/api/proposals/${proposalPath.split("/").pop()}/pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // Mark ready, send.
  await admin.getByRole("button", { name: "Mark ready to send" }).click();
  await expect(admin.getByText("Marked ready to send.")).toBeVisible();
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Send to client" }).click();
  await expect(admin.getByText(/Published to the client portal/)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText("Sent").first()).toBeVisible();

  // Share: client has no account yet → create invitation; WhatsApp message includes it.
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const message = admin.getByLabel("WhatsApp / message text");
  await expect(message).toHaveValue(/\/invite\//);
  const text = await message.inputValue();
  expect(text).toContain("One-time total: ₹6,999.00");
  const invite = text.match(/https?:\/\/\S+\/invite\/\S+/)![0];
  await expect(admin.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", /wa\.me\/919876501234/);
  await shot(admin, "p05-admin-share");

  // --- Client (mobile): join and review
  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const client = await clientCtx.newPage();
  await client.goto(new URL(invite).pathname);
  await client.getByLabel("Create a password").fill("ChaiPoint2026");
  await client.getByLabel("Confirm password").fill("ChaiPoint2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client.getByText("Proposals awaiting your review")).toBeVisible();
  await client.getByRole("link", { name: /Chai Point website/ }).click();
  await expect(client.locator(".doc .grand").getByText("₹6,999.00")).toBeVisible();
  await expect(client.getByText("SECRET-INTERNAL-NOTE")).toHaveCount(0);
  await expect(client.getByText("777")).toHaveCount(0); // provider cost stays internal
  await expect(client.getByText(/Recurring — not included in the one-time total/)).toBeVisible();
  await shot(client, "p06-client-proposal");

  // Question, then accept with the confirmation summary.
  await client.getByRole("textbox", { name: "Message" }).fill("Can we start next Monday?");
  await client.getByRole("button", { name: "Send" }).click();
  await expect(client.getByText("Can we start next Monday?")).toBeVisible();
  await client.getByRole("button", { name: "Review & accept" }).click();
  await expect(client.getByText("You are agreeing to")).toBeVisible();
  await client.getByLabel(/read the scope/).check();
  await client.getByLabel(/one-time total and the payment schedule/).check();
  await client.getByLabel(/recurring and third-party costs/).check();
  await shot(client, "p07-client-accept");
  await client.getByRole("button", { name: "Accept proposal" }).click();
  await expect(client.getByText(/Proposal accepted/)).toBeVisible();
  await client.reload();
  await expect(client.getByText(/Accepted electronically by Meera Iyer/)).toBeVisible();

  // --- Admin: dashboard stats, then create the project from the proposal.
  await admin.goto("/admin/proposals");
  await expect(admin.getByRole("link", { name: "Chai Point website" }).first()).toBeVisible();
  await shot(admin, "p08-proposals-dashboard");
  await admin.goto(proposalPath);
  await expect(admin.getByText("Can we start next Monday?")).toBeVisible();
  await admin.getByRole("button", { name: "Continue" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  await expect(admin.getByText(/client accepted the quotation/)).toBeVisible();
  const projectUrl = admin.url();
  await admin.goto(`${projectUrl}/billing`);
  await expect(admin.getByText("₹6,999.00").first()).toBeVisible();
  await expect(admin.getByText("Confirmed received")).toBeVisible();
  await expect(admin.locator(".stat-value").nth(1)).toHaveText("₹0.00");
  await shot(admin, "p09-project-billing");

  // A revised version is needed for any change and the accepted one stays intact.
  await admin.goto(proposalPath);
  await admin.getByRole("button", { name: "Create revised version" }).click();
  await expect(admin.getByText(/New draft version created/)).toBeVisible();
  await admin.goto(`${proposalPath}/edit`);
  await expect(admin.getByRole("heading", { name: /version 2/ })).toBeVisible();

  await adminCtx.close();
  await clientCtx.close();
});
