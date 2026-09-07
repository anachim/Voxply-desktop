import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The socket's own retry is the only thing that brings a dropped hub back:
// nothing in the web client listens for `online` or `visibilitychange`. Past
// REAUTH_AFTER_FAILURES it also asks the app for a fresh token, and it used to
// hand over completely — `return` before arming the timer. A re-auth that
// failed (a 429 off the shared auth limiter, a hub mid-restart) therefore
// ended the session in place, with the UI still announcing "Reconnecting…"
// (useHubConnection) for as long as the tab stayed open.

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = "blob";
  readyState = 0;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.onclose?.();
  }
}

async function dropTheLastSocket() {
  const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  last.onclose?.();
  // Let whatever backoff was armed elapse, whatever it is.
  await vi.advanceTimersByTimeAsync(60_000);
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HubWebSocket reconnect after the re-auth threshold", () => {
  it("keeps retrying when the app's re-auth attempt fails", async () => {
    const { HubWebSocket } = await import("../ws");
    // What a failing re-auth looks like from here: the app was asked, and no
    // new socket ever arrived to replace this one.
    const onReauthNeeded = vi.fn();

    new HubWebSocket("https://hub.example", "token", "hub-1", { onReauthNeeded });
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Three drops: the third crosses REAUTH_AFTER_FAILURES.
    await dropTheLastSocket();
    await dropTheLastSocket();
    await dropTheLastSocket();

    expect(onReauthNeeded).toHaveBeenCalledWith("hub-1");
    // The point: a fourth socket exists. Asking for a token is not a reason
    // to stop trying with the one we have.
    expect(FakeWebSocket.instances.length).toBeGreaterThan(3);

    // And it stays true — a re-auth that keeps failing must not run the
    // retries down either.
    await dropTheLastSocket();
    expect(FakeWebSocket.instances.length).toBeGreaterThan(4);
  });

  it("stops for good once close() is called", async () => {
    const { HubWebSocket } = await import("../ws");
    const socket = new HubWebSocket("https://hub.example", "token", "hub-1", {});

    socket.close();
    const after = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(after);
  });
});
