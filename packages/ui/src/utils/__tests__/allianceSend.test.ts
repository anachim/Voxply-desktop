import { describe, it, expect, vi } from "vitest";
import { sendToAllianceChannel, errorText } from "../allianceSend";
import type { Message } from "../../types";

const msgs = [{ id: "m1", content: "hi" }] as unknown as Message[];

function io(over: Partial<Parameters<typeof sendToAllianceChannel>[0]> = {}) {
  return {
    send: vi.fn(async () => {}),
    refresh: vi.fn(async () => msgs),
    onError: vi.fn(),
    ...over,
  };
}

describe("sendToAllianceChannel", () => {
  it("reports the send and hands back the refreshed channel", async () => {
    const deps = io();
    const res = await sendToAllianceChannel(deps, "  hello  ");

    expect(res).toEqual({ ok: true, messages: msgs });
    // Trimmed, so trailing whitespace never becomes a message of its own.
    expect(deps.send).toHaveBeenCalledWith("hello");
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("keeps ok=true when only the refresh fails", async () => {
    const deps = io({ refresh: vi.fn(async () => { throw new Error("hub blinked"); }) });
    const res = await sendToAllianceChannel(deps, "hello");

    // The message is on the other hub. Saying otherwise invites a double post.
    expect(res.ok).toBe(true);
    expect(res.messages).toBeNull();
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("reports a refused send, and does not go on to refresh", async () => {
    const deps = io({ send: vi.fn(async () => { throw new Error("alliance revoked"); }) });
    const res = await sendToAllianceChannel(deps, "hello");

    expect(res).toEqual({ ok: false, messages: null });
    expect(deps.onError).toHaveBeenCalledWith("alliance revoked");
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("treats a blank composer as nothing to do", async () => {
    const deps = io();
    const res = await sendToAllianceChannel(deps, "   ");

    expect(res).toEqual({ ok: false, messages: null });
    expect(deps.send).not.toHaveBeenCalled();
    // ok=false here must not clear the box either — there is nothing in it.
    expect(deps.onError).not.toHaveBeenCalled();
  });
});

describe("errorText", () => {
  it("unwraps an Error rather than stringifying it", () => {
    expect(errorText(new Error("nope"))).toBe("nope");
  });

  it("passes a bare string through — desktop's invoke rejects with one", () => {
    expect(errorText("command failed")).toBe("command failed");
  });
});
