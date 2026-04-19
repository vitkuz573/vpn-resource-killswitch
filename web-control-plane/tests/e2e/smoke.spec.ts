import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@vrks.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "E2E_Admin#12345";

test("login, account settings, overview and audit smoke", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/overview/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByRole("main")).toContainText("Runtime status & management");

  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("main")).toContainText("Account settings");

  const nextName = `E2E Admin ${Date.now()}`;
  await page.getByLabel("Display name").fill(nextName);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("pre")).toContainText("Profile updated");

  await page.getByRole("button", { name: "Revoke others" }).click();
  await expect(page.locator("pre")).toContainText("Session action 'revoke_others'");

  await page.getByRole("link", { name: "Audit" }).click();
  await expect(page).toHaveURL(/\/audit/);
  await expect(page.getByRole("main")).toContainText("Audit center");
});
