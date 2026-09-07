import { test, expect } from "@playwright/test";
import { expectInHub, hubApi, newMemberPage, uniqueName } from "./helpers/live";

// P61 — the branch where a DM would leave this device readable.
//
// It cannot be provoked against a healthy hub: every web client publishes its
// DH key on load, so a real recipient always has one. The route interception
// is the point rather than a shortcut — what is under test is the client's
// answer to what the hub says, and this is the only way to make the hub say
// it. Before 2026-09-07 the answer was to post the message in the clear and
// mention it to nobody, and a *failed* lookup got the same treatment as an
// absent key.

async function startDmWith(page: Parameters<typeof expectInHub>[0], memberName: string) {
  const memberRow = page.locator("li.user-list-item", { hasText: memberName });
  await expect(memberRow).toBeVisible({ timeout: 10000 });
  await memberRow.click({ button: "right" });
  await page.locator(".context-menu").getByText("Direct message").click();
  const composer = page.getByPlaceholder("Write a message");
  await expect(composer).toBeVisible({ timeout: 10000 });
  return composer;
}

test("a recipient with no published key gets asked about, not sent to", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expectInHub(page);

  const memberName = uniqueName("Keyless");
  const { context, page: member } = await newMemberPage(browser, memberName);
  try {
    await hubApi(page, "/channels", { method: "POST", body: { name: uniqueName("consent") } });

    // The hub reports this identity as having published no DH key.
    await page.route("**/identity/*/dh-key", (route) =>
      route.fulfill({ status: 404, body: "no key" }),
    );

    await page.reload();
    await expectInHub(page);
    const composer = await startDmWith(page, memberName);

    const text = `should-not-leave ${Date.now()}`;
    await composer.fill(text);
    await composer.press("Enter");

    // Asked, not sent.
    const dialog = page.getByRole("dialog", { name: "Not encrypted" });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(text).first()).not.toBeVisible();

    // Declining leaves the message where it was typed — losing it would be
    // its own bug, and the reason the composer clears last.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(composer).toHaveValue(text);

    // Consenting sends it.
    await composer.press("Enter");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Send anyway" }).click();
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 10000 });
  } finally {
    await context.close();
  }
});

test("a key lookup that fails is not read as a missing key", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expectInHub(page);

  const memberName = uniqueName("Ratelimited");
  const { context, page: member } = await newMemberPage(browser, memberName);
  try {
    await hubApi(page, "/channels", { method: "POST", body: { name: uniqueName("consent") } });

    // The shared per-IP auth limiter answers this way under load, and so does
    // a hub halfway through a restart.
    await page.route("**/identity/*/dh-key", (route) =>
      route.fulfill({ status: 429, body: "Rate limit exceeded" }),
    );

    await page.reload();
    await expectInHub(page);
    const composer = await startDmWith(page, memberName);

    const text = `must-not-leak ${Date.now()}`;
    await composer.fill(text);
    await composer.press("Enter");

    // No prompt: there is no decision to put to the user, because nothing is
    // known about this recipient's key. And nothing sent, in any form.
    await expect(page.getByRole("dialog", { name: "Not encrypted" })).not.toBeVisible();
    await expect(page.getByText(text).first()).not.toBeVisible();
    await expect(composer).toHaveValue(text);
  } finally {
    await context.close();
  }
});
