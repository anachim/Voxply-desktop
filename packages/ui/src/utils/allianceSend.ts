import type { Message } from "../types";

export interface AllianceSendIO {
  send: (content: string) => Promise<void>;
  refresh: () => Promise<Message[]>;
  onError: (message: string) => void;
}

export interface AllianceSendResult {
  /** Whether the hub took the message. The caller owns the composer and
   *  clears it only on true, so a refused send keeps what was typed. */
  ok: boolean;
  /** The channel as it reads after the send, or null if the refresh failed —
   *  which is not a failed send and must not be reported as one. */
  messages: Message[] | null;
}

/** Posting to a channel the *other* hub hosts is two round trips: our hub
 *  relays the message, then we re-read the channel through it (there is no
 *  live socket to a hub we are only allied with). They fail independently, and
 *  conflating them is what would tell someone their message did not send when
 *  it did — inviting them to post it twice. */
export async function sendToAllianceChannel(
  io: AllianceSendIO,
  content: string,
): Promise<AllianceSendResult> {
  const text = content.trim();
  if (!text) return { ok: false, messages: null };

  try {
    await io.send(text);
  } catch (e) {
    io.onError(errorText(e));
    return { ok: false, messages: null };
  }

  try {
    return { ok: true, messages: await io.refresh() };
  } catch (e) {
    console.warn("[alliances] sent, but could not refresh the channel:", e);
    return { ok: true, messages: null };
  }
}

/** Web throws HubApiError (its message is already user-facing); desktop's
 *  invoke rejects with a plain string. `String(e)` on an Error would prefix
 *  "Error: ", which nobody wants to read. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
