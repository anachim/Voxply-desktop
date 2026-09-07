import { test, expect } from "@playwright/test";
import { expectInHub } from "./helpers/live";

// P17 — mic level meter in Settings → Voice (client-only; getUserMedia +
// AnalyserNode). Chromium's fake capture device feeds a tone, which is enough
// to drive the meter and to cross the transmit gate — so this also covers the
// verdict the meter now gives about whether anyone would actually hear you.

test("mic test meter renders and toggles", async ({ page }) => {
  await page.goto("/");
  await expectInHub(page);

  await page.locator(".btn-icon-gear").click();
  await page.getByRole("button", { name: "Voice", exact: true }).click();

  await expect(page.getByText("Microphone test")).toBeVisible();
  const meter = page.getByRole("meter", { name: "Microphone level" });
  await expect(meter).toBeVisible();

  // The level at which transmission actually starts, drawn on the bar. Without
  // it the meter answers "is my mic working", which is not the question
  // someone nobody can hear is asking.
  await expect(
    meter.locator("[title='Wavvon starts transmitting at this level']"),
  ).toBeVisible();

  // And the setting that moves that line, on the standard profile — it used to
  // live inside the custom audio panel, so the one control over whether anyone
  // hears you was reachable only by switching profile. Desktop has always had
  // it in the open.
  const sensitivity = page.locator("#vad-sensitivity");
  await expect(sensitivity).toBeVisible();
  await expect(sensitivity).toHaveValue("0.02");

  // "Test microphone" until the voice tab was localized (clients 5e90ac8):
  // the label is now settings.voice.mic_test.start.
  await page.getByRole("button", { name: "Start mic test" }).click();
  await expect(page.getByRole("button", { name: "Stop test" })).toBeVisible({ timeout: 10000 });

  // `--use-fake-device-for-media-stream` feeds a tone loud enough to cross the
  // gate, so this is the "nothing to fix here" verdict. (The header of this
  // file used to say fake audio would not move the bar. It does — that claim
  // was only ever tested against a meter that said nothing either way.)
  const verdict = page.getByText("Loud enough", { exact: false });
  await expect(verdict).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Stop test" }).click();
  await expect(page.getByRole("button", { name: "Start mic test" })).toBeVisible();
  // The verdict belongs to the run that produced it.
  await expect(verdict).not.toBeVisible();
});
