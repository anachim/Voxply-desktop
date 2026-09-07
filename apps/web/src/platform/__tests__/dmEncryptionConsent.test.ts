import { describe, it, expect, beforeEach, vi } from "vitest";
import { bytesToHex, publicKeyHex } from "@wavvon/core";

// The one path where a wrong answer is not a bug but a disclosure: sendDm
// deciding whether a DM may leave this device readable. It used to decide by
// asking for the recipient's DH key and treating *any* null as "cannot
// encrypt" — including the null that `fetchDhKey` returned for a request that
// simply failed. A rate-limited moment was enough to post the message to the
// hub in the clear, with nothing said to anyone.

const SENDER_SEED = bytesToHex(new Uint8Array(32).fill(1));
const SENDER_PUB = publicKeyHex(SENDER_SEED);
const RECIPIENT_PUB = publicKeyHex(bytesToHex(new Uint8Array(32).fill(2)));
const HUB = "https://hub.example";

const dmFetch = vi.fn();

vi.mock("../dmHub", () => ({
  dmFetch: (path: string, init?: RequestInit) => dmFetch(path, init),
  dmSession: async () => ({ hub_url: HUB, token: "t" }),
}));

vi.mock("../session", () => ({
  activeSession: () => ({ hub_url: HUB, token: "t", hub_id: "h" }),
}));

vi.mock("../../identity/store", () => ({
  loadIdentity: async () => ({ id: "acct", seed_hex: SENDER_SEED, security_nonce: 0, security_level: 0 }),
  saveIdentity: async () => {},
}));

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

/** Every POST of a message body, as the hub would have received it. */
function postedBodies(): Record<string, unknown>[] {
  return dmFetch.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>);
}

function dhKeyResponse(status: number, hex?: string) {
  return async (url: string) => {
    if (String(url).includes("/dh-key")) {
      return hex
        ? new Response(JSON.stringify({ dh_pubkey_hex: hex, signature_hex: "00" }), { status: 200 })
        : new Response("nope", { status });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

beforeEach(() => {
  vi.resetModules();
  dmFetch.mockReset();
  // The conversation read, then the message POST.
  dmFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "m1" }), { status: 201 });
    return new Response(
      JSON.stringify({ id: "c1", members: [SENDER_PUB, RECIPIENT_PUB], conv_type: "dm" }),
      { status: 200 },
    );
  });
});

async function sendDm(...args: Parameters<typeof import("../commands/dms")["sendDm"]>) {
  const mod = await import("../commands/dms");
  return mod.sendDm(...args);
}

describe("sendDm and the recipient's encryption key", () => {
  it("refuses rather than falling back to plaintext when the key lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(dhKeyResponse(429)));
    const confirmUnencrypted = vi.fn(async () => true);

    await expect(sendDm("c1", "secret", undefined, { confirmUnencrypted })).rejects.toThrow();

    // The whole point: nothing was posted, encrypted or otherwise.
    expect(postedBodies()).toHaveLength(0);
    // And the user was never asked — a failed lookup is not a missing key,
    // so there is no decision to put to them.
    expect(confirmUnencrypted).not.toHaveBeenCalled();
  });

  it("asks before sending in the clear to a recipient who has published no key", async () => {
    vi.stubGlobal("fetch", vi.fn(dhKeyResponse(404)));
    const confirmUnencrypted = vi.fn(async () => true);

    const res = await sendDm("c1", "secret", undefined, { confirmUnencrypted });

    expect(confirmUnencrypted).toHaveBeenCalled();
    expect(res).toBe("sent");
    expect(postedBodies()).toEqual([{ content: "secret", attachments: undefined }]);
  });

  it("sends nothing when the user declines", async () => {
    vi.stubGlobal("fetch", vi.fn(dhKeyResponse(404)));

    const res = await sendDm("c1", "secret", undefined, { confirmUnencrypted: async () => false });

    expect(res).toBe("cancelled");
    expect(postedBodies()).toHaveLength(0);
  });

  it("sends nothing when no one is there to ask", async () => {
    vi.stubGlobal("fetch", vi.fn(dhKeyResponse(404)));

    // No callback is not consent. Refusing is the only direction that cannot
    // leak, so it is the default.
    const res = await sendDm("c1", "secret");

    expect(res).toBe("cancelled");
    expect(postedBodies()).toHaveLength(0);
  });
});
