import { test, expect, type Page } from "@playwright/test";
import { channelButton, createChannel, expectInHub, hubApi, newMemberPage, uniqueName } from "./helpers/live";

// P18 — admin features ported from desktop: audit log, native bots, hub
// icon library, alliances, onboarding (lobby/challenge), and per-channel
// bans. Each is gated on admin (the owner session is admin).

async function openAdminTab(page: Page, tab: string) {
  await page.locator(".hub-header-button").click();
  await page.getByRole("button", { name: "Hub settings" }).click();
  await page.getByRole("button", { name: tab, exact: true }).click();
}

test("audit log lists administrative events", async ({ page }) => {
  await page.goto("/");
  await expectInHub(page);
  await openAdminTab(page, "Audit log");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  // The suite has generated plenty of audit activity by now.
  await expect(page.locator("table.members-table tbody tr").first()).toBeVisible({ timeout: 10000 });
});

// This used to create and delete a "native bot" -- a bot the hub minted a
// token for, through POST /admin/bots. That model is gone: there is one bot
// model now, an externally operated bot invited by its Ed25519 pubkey, which is
// what the hub advertises as the `bots.external` capability. The old test kept
// asserting a tab, a heading and a form that no longer exist, and nothing
// noticed because this suite has never run anywhere but a laptop.
test("invite an external bot and remove it", async ({ page }) => {
  await page.goto("/");
  await expectInHub(page);
  await openAdminTab(page, "Bots");
  await expect(page.getByRole("heading", { name: "External Bots" })).toBeVisible();

  // A bot is identified by its pubkey, so the unique-per-run value has to be
  // one: 64 hex chars, unique via the run suffix rather than a name.
  const suffix = uniqueName("").replace(/[^0-9a-f]/g, "");
  const botPubkey = (suffix + "0".repeat(64)).slice(0, 64);
  const note = uniqueName("Botty");

  await page.getByPlaceholder(/hex pubkey/).fill(botPubkey);
  await page.getByPlaceholder(/moderation bot/).fill(note);
  await page.getByRole("button", { name: "Generate invite token" }).click();

  // The token is shown once and only once, which is the whole point of it.
  await expect(page.getByText(/expires in 24 hours/)).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Dismiss" }).click();

  const row = page.locator("table.members-table tr", { hasText: note });
  await expect(row).toBeVisible({ timeout: 10000 });
  page.on("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remove" }).click();

  // Removing does not delete the row, it moves the bot to "Removed" — the
  // grant stays visible so an admin can see a bot was once trusted here. The
  // first version of this test asserted the row disappeared and was wrong
  // about the feature, not about the app.
  await expect(row).toContainText("Removed", { timeout: 10000 });
});

test("create and delete a hub SVG icon", async ({ page }) => {
  await page.goto("/");
  await expectInHub(page);
  await openAdminTab(page, "Icons");
  await expect(page.getByRole("heading", { name: "Icon library" })).toBeVisible();

  const iconName = uniqueName("star");
  await page.getByPlaceholder("Icon name").fill(iconName);
  await page.getByText("Advanced: paste SVG markup").click();
  await page.getByLabel("SVG markup").fill('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  await page.getByRole("button", { name: "Add icon" }).click();

  const card = page.locator(".settings-section", { hasText: iconName });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).toBeHidden({ timeout: 10000 });
});

test("alliance: create, share a channel, unshare, leave", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expectInHub(page);

  // A channel to share into the alliance.
  const chan = uniqueName("shared");
  await createChannel(page, chan);

  await openAdminTab(page, "Alliances");
  await expect(page.getByRole("heading", { name: "Alliances" })).toBeVisible();

  const name = uniqueName("Pact");
  await page.getByPlaceholder("Alliance name").fill(name);
  await page.getByRole("button", { name: "Create alliance" }).click();

  const section = page.locator(".alliance-row", { hasText: name });
  await expect(section).toBeVisible({ timeout: 10000 });

  // Expand the alliance and share the channel. The select's option label
  // carries the channel's "# " icon prefix (AlliancesSection.tsx), not the
  // bare name.
  await section.getByRole("button", { name: new RegExp(name) }).click();
  await section.locator("select").selectOption({ label: `# ${chan}` });
  await section.getByRole("button", { name: "Share", exact: true }).click();
  // getByText also matches the (still-present) <option> with the same label
  // in the share select — scope to the shared-channel row itself.
  await expect(section.locator(".settings-row", { hasText: `# ${chan}` })).toBeVisible({ timeout: 10000 });

  // Unshare it.
  await section.getByRole("button", { name: "Unshare" }).click();
  await expect(section.getByText("No channels shared yet.")).toBeVisible({ timeout: 10000 });

  // Leave the alliance.
  await section.getByRole("button", { name: "Leave" }).click();
  await expect(page.locator(".alliance-row", { hasText: name })).toBeHidden({ timeout: 10000 });
});

test("onboarding: save challenge settings", async ({ page }) => {
  await page.goto("/");
  await expectInHub(page);
  await openAdminTab(page, "Onboarding");
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();

  // Challenge settings are write-only; saving should report success.
  await page.getByRole("button", { name: "Save challenge" }).click();
  await expect(page.getByText("Challenge settings saved")).toBeVisible({ timeout: 10000 });
});

test("channel bans: ban and unban a real member", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expectInHub(page);

  // The ban target must be a real user (FK constraint), so onboard one.
  const memberName = uniqueName("Banned");
  const { context } = await newMemberPage(browser, memberName);
  try {
    const channel = uniqueName("banch");
    await createChannel(page, channel);
    const row = channelButton(page, channel);
    await row.hover();
    await row.getByRole("button", { name: "Channel settings" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Bans", exact: true }).click();

    // The bans tab picks the target from the member list (a select), not a
    // raw pubkey field, when the caller (App.tsx) supplies the users prop.
    await dialog.getByLabel("User to ban").selectOption({ label: memberName });
    await dialog.getByRole("button", { name: "Ban", exact: true }).click();

    // The ban entry renders with an Unban button (pubkey is formatted, so
    // target the button rather than matching the key text).
    const unban = dialog.getByRole("button", { name: "Unban" });
    await expect(unban).toBeVisible({ timeout: 10000 });
    await unban.click();
    await expect(dialog.getByText("No one is banned from this channel.")).toBeVisible({ timeout: 10000 });

    // Confirm via API too.
    const channels = await hubApi<Array<{ id: string; name: string }>>(page, "/channels");
    const ch = channels.find((c) => c.name === channel)!;
    const bans = await hubApi<unknown[]>(page, `/channels/${ch.id}/bans`);
    expect(bans.length).toBe(0);
  } finally {
    await context.close();
  }
});

// The moderation queue. Hoisted into packages/ui 2026-09-08 so desktop could
// have it too, and it had no e2e coverage on either side until then — a
// shared component reached through two different transports is exactly the
// thing worth mounting for real once.
test("the moderation tab shows the content report queue", async ({ page }) => {
  await page.goto("/");
  await expectInHub(page);
  await openAdminTab(page, "Moderation");

  await expect(page.getByRole("heading", { name: "Content Reports" })).toBeVisible();
  // Nobody has reported anything on this hub, and saying so is the section
  // having loaded — an error would render in its place.
  await expect(page.getByText("No pending reports", { exact: false })).toBeVisible({
    timeout: 10000,
  });

  // The automod webhook sits in the same tab and was hoisted with it. Its
  // circuit-breaker row is what says the section reached the hub rather than
  // rendering its own defaults.
  await expect(page.getByRole("heading", { name: "Auto-moderation Webhook" })).toBeVisible();
  await expect(page.getByText("Circuit closed", { exact: false })).toBeVisible({ timeout: 10000 });
});
