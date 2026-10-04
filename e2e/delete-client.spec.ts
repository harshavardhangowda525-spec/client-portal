import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@infinity.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminPass2026";

test("delete a client from the admin dashboard", async ({ page }) => {
  const name = `Delete Me ${Date.now().toString(36)}`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/clients/new");
  await page.getByLabel("Business name").fill(name);
  await page.getByLabel("Owner name").fill("Test Owner");
  await page.getByLabel("Email").fill(`${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  await page.getByLabel("Project name").fill("Throwaway site");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/admin\/projects\//);

  // From the list, the trash icon leads to the confirmation on the client page.
  await page.goto("/admin/clients");
  await page.getByRole("link", { name: `Delete ${name}` }).click();
  await expect(page.getByText(/permanently deletes/)).toBeVisible();
  const button = page.getByRole("button", { name: "Delete client permanently" });
  await expect(button).toBeDisabled();
  await page.getByLabel(/to confirm/).fill("wrong name");
  await expect(button).toBeDisabled();
  await page.getByLabel(/to confirm/).fill(name.toLowerCase());
  await expect(button).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  await button.click();
  await expect(page).toHaveURL(/\/admin\/clients\?deleted=1/);
  await expect(page.getByText("Client deleted permanently.")).toBeVisible();
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});
