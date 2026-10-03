import { test, expect, type Page } from "@playwright/test";

/**
 * Full business workflow through the real UI:
 * client + project → quotation → invitation → client accepts → commencement →
 * milestones → preview feedback → invoice & payment → handover.
 *
 * Requires a running app and an existing admin:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (defaults match the local dev setup).
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const stamp = Date.now().toString(36);
const clientEmail = `owner-${stamp}@example.test`;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("complete client project workflow", async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const client = await clientCtx.newPage();

  // --- Admin: sign in, create client and project
  await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(admin).toHaveURL(/\/admin$/);
  await shot(admin, "01-admin-dashboard-empty");
  await admin.goto("/admin/clients/new");
  await admin.getByLabel("Business name").fill(`Brew & Bloom Cafe ${stamp}`);
  await admin.getByLabel("Business category").fill("Cafe / restaurant");
  await admin.getByLabel("Owner name").fill("Priya Sharma");
  await admin.getByLabel("Email").fill(clientEmail);
  await admin.getByLabel("Phone / WhatsApp").fill("9876543210");
  await admin.getByRole("button", { name: "Create client" }).click();
  await expect(admin).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = admin.url();
  await admin.getByLabel("Project name").fill("Cafe Website Development");
  await admin.getByRole("button", { name: "Create project" }).click();
  await expect(admin).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = admin.url();
  await shot(admin, "02-admin-project-overview");

  // --- Admin: create a quotation from the template, add GST, save and send
  await admin.goto(`${projectUrl}/quotations`);
  await admin.getByRole("button", { name: "Create draft" }).click();
  await expect(admin.getByRole("heading", { name: "Draft quotation" })).toBeVisible();
  await admin.getByLabel("Tax rate percent").fill("18");
  await admin.getByLabel("Tax label").fill("GST");
  await expect(admin.getByText("₹47,200.00").first()).toBeVisible(); // 40,000 + 18%
  await admin.getByRole("button", { name: "Save draft" }).click();
  await expect(admin.getByText("Draft saved.")).toBeVisible();
  await shot(admin, "03-admin-quotation-editor");
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Send to client" }).click();
  await expect(admin.getByText(/Quotation sent/)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText(/has been sent and can no longer be edited/)).toBeVisible();

  // --- Admin: invite the client (email not configured → copy link)
  await admin.goto(clientUrl);
  await admin.getByRole("button", { name: "Create invitation link" }).click();
  const linkEl = admin.locator("code").filter({ hasText: "/invite/" });
  await expect(linkEl).toBeVisible();
  const inviteLink = (await linkEl.textContent())!.trim();
  await expect(admin.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", /wa\.me\/919876543210/);
  await shot(admin, "04-admin-invite");

  // --- Client (mobile): accept invitation and create account
  await client.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ""));
  await expect(client.getByRole("heading", { name: /Welcome, Priya/ })).toBeVisible();
  await shot(client, "05-client-invite");
  await client.getByLabel("Create a password").fill("CafeOwner2026");
  await client.getByLabel("Confirm password").fill("CafeOwner2026");
  await client.getByRole("button", { name: /Create account/ }).click();
  await expect(client).toHaveURL(/\/portal\/[0-9a-f-]{36}$/);
  const portalUrl = client.url();
  await expect(client.getByText("Needs your attention")).toBeVisible();
  await expect(client.getByText("Preview not ready yet")).toBeVisible();
  await shot(client, "06-client-overview-proposal");

  // invitation link is single-use
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ""));
  await expect(otherPage.getByText("This invitation has already been used")).toBeVisible();
  await other.close();

  // --- Client: review and accept the quotation
  await client.goto(`${portalUrl}/quotation`);
  await expect(client.getByText("Services & pricing")).toBeVisible();
  await shot(client, "07-client-quotation");
  await client.getByRole("button", { name: "Accept quotation" }).click();
  await client.getByLabel(/reviewed the services/).check();
  await client.getByLabel(/agree to the payment milestones/).check();
  await client.getByRole("button", { name: "Accept & sign" }).click();
  await expect(client.getByText(/Quotation accepted/)).toBeVisible();
  await client.reload();
  await expect(client.getByText(/Accepted by Priya Sharma/)).toBeVisible();

  // --- Admin: notified; activate project
  await admin.goto("/admin/notifications");
  await expect(admin.getByText(/accepted quotation IWA-Q-/).first()).toBeVisible();
  await admin.goto(projectUrl);
  await expect(admin.getByText(/client accepted the quotation/)).toBeVisible();
  await admin.getByRole("button", { name: /Confirm commencement/ }).click();
  await expect(admin.getByText(/Project activated/)).toBeVisible();

  // --- Admin: progress milestones
  await admin.goto(`${projectUrl}/milestones`);
  for (const title of ["Offer accepted", "Requirements collected", "Quotation approved", "Advance payment confirmed"]) {
    await admin.getByRole("button", { name: `Edit ${title}` }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Status").selectOption("completed");
    await dialog.getByRole("button", { name: "Save milestone" }).click();
    await expect(dialog).toBeHidden();
  }
  await admin.getByRole("button", { name: "Edit Design and layout" }).click();
  await admin.getByRole("dialog").getByLabel("Status").selectOption("in_progress");
  await admin.getByRole("dialog").getByLabel(/Update note/).fill("Colour palette and layout direction underway");
  await admin.getByRole("dialog").getByRole("button", { name: "Save milestone" }).click();
  await expect(admin.getByRole("dialog")).toBeHidden();
  await expect(admin.getByText("12%").first()).toBeVisible();
  await shot(admin, "08-admin-milestones");

  // --- Admin: publish a preview and post an update requesting feedback
  await admin.goto(`${projectUrl}/previews`);
  await admin.getByLabel("Preview URL").fill(process.env.E2E_PREVIEW_URL ?? "http://localhost:3000/api/health");
  await admin.getByLabel("Title").fill("Homepage first draft");
  await admin.getByRole("button", { name: "Publish preview" }).click();
  await expect(admin.getByText(/Preview published/)).toBeVisible();
  await admin.goto(`${projectUrl}/updates`);
  await admin.getByLabel("Title").fill("Homepage design ready");
  await admin.getByLabel("Message").fill("Please review the homepage colours and let us know.");
  await admin.getByLabel(/Ask the client for feedback/).check();
  await admin.getByRole("button", { name: "Post update" }).click();
  await expect(admin.getByText("Update posted.")).toBeVisible();
  await admin.getByLabel("Title").fill("Internal: chase menu photos");
  await admin.getByLabel("Visibility").selectOption("internal");
  await admin.getByRole("button", { name: "Post update" }).click();
  await expect(admin.getByText("Internal only").first()).toBeVisible();

  // --- Client: sees progress, preview, gives feedback, answers request, messages
  await client.goto(portalUrl);
  await expect(client.getByText("12%").first()).toBeVisible();
  await expect(client.getByRole("link", { name: "View website preview" })).toBeVisible();
  await shot(client, "09-client-overview-active");
  await client.goto(`${portalUrl}/updates`);
  await expect(client.getByText("Homepage design ready")).toBeVisible();
  await expect(client.getByText("Internal: chase menu photos")).toHaveCount(0);
  await client.goto(`${portalUrl}/preview`);
  // The test preview URL is this portal itself, which forbids framing (X-Frame-Options: DENY),
  // so embed detection must fall back to an external link instead of a broken iframe.
  await expect(client.getByText("This preview opens in a new tab")).toBeVisible();
  await expect(client.getByRole("link", { name: "Open preview" })).toHaveAttribute("href", /api\/health/);
  await shot(client, "10-client-preview");
  await client.getByRole("button", { name: "Request changes" }).click();
  await client.getByLabel("What should we change?").fill("Please make the logo larger.");
  await client.getByRole("button", { name: "Send feedback" }).click();
  await expect(client.getByText(/feedback was sent/)).toBeVisible();
  await client.goto(portalUrl);
  await client.getByRole("button", { name: "Reply" }).first().click();
  await client.getByLabel("Your response").fill("Colours look great!");
  await client.getByRole("button", { name: "Send" }).click();
  await expect(client.getByText(/response was sent/)).toBeVisible();
  await client.goto(`${portalUrl}/messages`);
  await client.getByLabel("Message").fill("When will the menu page be ready?");
  await client.getByRole("button", { name: "Send" }).click();
  await expect(client.locator(".msg").filter({ hasText: "When will the menu page be ready?" })).toBeVisible();

  // --- Admin: sees feedback and message, replies
  await admin.goto(`${projectUrl}/messages`);
  await expect(admin.getByText("When will the menu page be ready?")).toBeVisible();
  await admin.getByLabel("Message").fill("By Friday!");
  await admin.getByRole("button", { name: "Send" }).click();
  await expect(admin.locator(".msg").filter({ hasText: "By Friday!" })).toBeVisible();
  await admin.goto(projectUrl);
  await expect(admin.getByText("“Colours look great!”", { exact: false })).toBeVisible();

  // --- Admin: invoice the advance and record a confirmed payment
  await admin.goto(`${projectUrl}/billing`);
  await admin.getByRole("button", { name: "Create invoice" }).first().click();
  await expect(admin.getByText("Draft invoice created.")).toBeVisible();
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Issue" }).click();
  await expect(admin.getByText(/Invoice issued/)).toBeVisible();
  await admin.reload();
  await admin.locator("#rp-inv").selectOption({ index: 1 });
  await admin.locator("#rp-amt").fill("23600");
  await admin.getByLabel("Method").selectOption("upi");
  await admin.getByLabel("Transaction reference").fill("UPI-REF-123456");
  await admin.getByLabel("Confirmation").selectOption("confirmed");
  await admin.getByRole("button", { name: "Record payment" }).click();
  await expect(admin.getByText(/Payment recorded and confirmed/)).toBeVisible();
  await shot(admin, "11-admin-billing");

  // --- Client: sees invoice paid and the balance
  await client.goto(`${portalUrl}/payments`);
  await expect(client.getByText("UPI-REF-123456")).toBeVisible();
  await expect(client.getByText("₹23,600.00").first()).toBeVisible();
  await client.screenshot({ path: `${SHOTS ?? "test-results"}/12b-client-payments-viewport.png` });
  await shot(client, "12-client-payments");
  const pdf = await client.request.get(await client.getByRole("link", { name: "Receipt" }).first().getAttribute("href") as string);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // --- Admin: finish all milestones and complete the project (handover)
  await admin.goto(`${projectUrl}/milestones`);
  const editButtons = admin.getByRole("button", { name: /^Edit / });
  const count = await editButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = editButtons.nth(i);
    const item = admin.locator(".t-item").nth(i);
    if ((await item.getAttribute("data-status")) === "completed") continue;
    await btn.click();
    await admin.getByRole("dialog").getByLabel("Status").selectOption("completed");
    await admin.getByRole("dialog").getByRole("button", { name: "Save milestone" }).click();
    await expect(admin.getByRole("dialog")).toBeHidden();
  }
  await admin.goto(projectUrl);
  await admin.getByLabel("Change status").selectOption("completed");
  await admin.getByRole("button", { name: "Update" }).click();
  await expect(admin.getByText("Project status updated.")).toBeVisible();

  await client.goto(portalUrl);
  await expect(client.getByText("100%").first()).toBeVisible();
  await expect(client.getByText("Completed").first()).toBeVisible();
  await shot(client, "13-client-completed");
  await client.goto(`${portalUrl}/timeline`);
  await shot(client, "14-client-timeline");

  // --- Access control: the client cannot open admin pages or other projects
  await client.goto("/admin");
  await expect(client).toHaveURL(/\/portal/);
  const res = await client.request.get("/api/documents/00000000-0000-0000-0000-000000000000");
  expect(res.status()).toBe(404);

  await adminCtx.close();
  await clientCtx.close();
});
