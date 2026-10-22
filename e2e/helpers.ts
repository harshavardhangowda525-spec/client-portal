import { expect, type Page } from "@playwright/test";

/** From a project's Proposal tab: create a proposal (base package), optionally send it. Returns the proposal path. */
export async function createProjectProposal(admin: Page, projectUrl: string, opts: { send?: boolean } = {}) {
  await admin.goto(`${projectUrl}/proposal`);
  await admin.getByRole("link", { name: "Create proposal for this project" }).first().click();
  await admin.getByRole("button", { name: "Save & continue" }).click();
  await expect(admin.getByText(/Draft saved · IWA-P-/)).toBeVisible();
  if (!opts.send) return null;
  for (let i = 0; i < 5; i++) await admin.getByRole("button", { name: "Save & continue" }).click();
  await admin.getByRole("button", { name: "Use “Two payments”" }).click();
  await admin.getByRole("button", { name: "Save & continue" }).click();
  await admin.getByRole("button", { name: "Save & preview" }).click();
  await expect(admin).toHaveURL(/\/admin\/proposals\/[0-9a-f-]{36}$/);
  const path = new URL(admin.url()).pathname;
  await admin.getByRole("button", { name: "Mark ready to send" }).click();
  await expect(admin.getByText("Marked ready to send.")).toBeVisible();
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "Send to client" }).click();
  await expect(admin.getByText(/Published to the client portal/)).toBeVisible();
  return path;
}
