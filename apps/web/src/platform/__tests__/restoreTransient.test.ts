import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActiveAccountId } from "../../identity/store";
import { resetHubSessions, getSession } from "../session";

// restorePersistedHubs (platform/commands/hubs.ts) is the only thing standing
// between a saved hub and the welcome screen, and its fallback is to drop the
// hub. The web client keeps its token in sessionStorage unless asked to
// remember it, so this path re-authenticates on EVERY page load, against an
// auth limiter the hub keys by IP — a 429 there is ordinary traffic, not a
// broken hub, and treating it as one loses every community the user has.

const localStorageData: Record<string, string> = {};
const sessionStorageData: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => localStorageData[k] ?? null,
  setItem: (k: string, v: string) => {
    localStorageData[k] = v;
  },
  removeItem: (k: string) => {
    delete localStorageData[k];
  },
});
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => sessionStorageData[k] ?? null,
  setItem: (k: string, v: string) => {
    sessionStorageData[k] = v;
  },
  removeItem: (k: string) => {
    delete sessionStorageData[k];
  },
});

// The socket is not what this is about; constructing one would open a real
// connection to a hub that does not exist.
vi.mock("../ws", () => ({
  HubWebSocket: class {
    close() {}
  },
}));

vi.mock("../../identity/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../identity/store")>();
  return {
    ...actual,
    loadIdentity: async () => ({
      id: "acct",
      seed_hex: "aa".repeat(32),
      security_nonce: 0,
      security_level: 0,
    }),
    saveIdentity: async () => {},
  };
});

const HUB_URL = "https://hub.example";
const HUB_ID = "hub-pub-key";

function saveOneHub() {
  localStorageData["wavvon:acct:acct:wavvon:saved_hubs"] = JSON.stringify([
    {
      hub_id: HUB_ID,
      hub_name: "Hub",
      hub_url: HUB_URL,
      hub_icon: null,
      remember_token: false,
    },
  ]);
  localStorageData["wavvon:acct:acct:wavvon:active_hub"] = HUB_ID;
}

// Answers /info and /auth/verify normally; /auth/challenge fails with
// `failures` responses of `status` before succeeding.
function fetchFailingChallenge(failures: number, status: number) {
  let seen = 0;
  return vi.fn(async (url: string) => {
    if (url === `${HUB_URL}/info`) {
      return new Response(JSON.stringify({ public_key: HUB_ID, name: "Hub" }), { status: 200 });
    }
    if (url === `${HUB_URL}/auth/challenge`) {
      if (seen++ < failures) return new Response("Rate limit exceeded", { status });
      return new Response(JSON.stringify({ challenge: "00".repeat(32) }), { status: 200 });
    }
    if (url === `${HUB_URL}/auth/verify`) {
      return new Response(JSON.stringify({ token: "fresh-token" }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  for (const k of Object.keys(localStorageData)) delete localStorageData[k];
  for (const k of Object.keys(sessionStorageData)) delete sessionStorageData[k];
  resetHubSessions();
  setActiveAccountId("acct");
  vi.useFakeTimers();
});

async function restore() {
  const { restorePersistedHubs } = await import("../commands/hubs");
  const promise = restorePersistedHubs({} as never);
  // Each retry delay is scheduled only once the fetch before it has settled,
  // so a single drain runs out nothing but the first — keep advancing.
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5000);
  return promise;
}

describe("restorePersistedHubs under a rate-limited hub", () => {
  it("keeps the hub when the auth handshake is rate-limited and then succeeds", async () => {
    saveOneHub();
    vi.stubGlobal("fetch", fetchFailingChallenge(2, 429));

    const hubs = await restore();

    expect(hubs.map((h) => h.hub_id)).toEqual([HUB_ID]);
    expect(getSession(HUB_ID)?.token).toBe("fresh-token");
  });

  it("keeps the hub through a 5xx too", async () => {
    saveOneHub();
    vi.stubGlobal("fetch", fetchFailingChallenge(1, 503));

    const hubs = await restore();

    expect(hubs.map((h) => h.hub_id)).toEqual([HUB_ID]);
  });

  it("does not retry a refusal — a 403 is about this hub, not about timing", async () => {
    saveOneHub();
    const fetchMock = fetchFailingChallenge(1, 403);
    vi.stubGlobal("fetch", fetchMock);

    const hubs = await restore();

    expect(hubs).toEqual([]);
    // /info once, /auth/challenge once — no second attempt.
    expect(fetchMock.mock.calls.filter((c) => c[0] === `${HUB_URL}/auth/challenge`)).toHaveLength(1);
  });
});
