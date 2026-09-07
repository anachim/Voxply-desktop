import type { VoiceKeyBundle } from "./voiceKeys";
import { pushSample, rttStats, type RttStats } from "./connectionStats";

/** How often to probe. Two seconds keeps the readout feeling live without
 *  making the measurement itself part of the traffic it measures. */
const PING_INTERVAL_MS = 2000;

export interface WsHandlers {
  onMessage?: (m: object) => void;
  onDm?: (m: object) => void;
  onDmMemberChanged?: (e: object) => void;
  onTyping?: (e: object) => void;
  onVoiceState?: (e: object) => void;
  onVideo?: (e: object) => void;
  onWhisper?: (e: object) => void;
  onVoiceZoneCreated?: (e: object) => void;
  onVoiceZoneDestroyed?: (e: object) => void;
  onVoicePositionUpdated?: (e: object) => void;
  onVoiceZoneState?: (e: object) => void;
  onScreenShare?: (e: object) => void;
  onScreenShareChunk?: (streamId: string, isInit: boolean, data: ArrayBuffer) => void;
  onStatusChange?: (connected: boolean, hubId: string) => void;
  onPin?: (e: object) => void;
  onPoll?: (e: object) => void;
  onSoundboardPlayed?: (e: object) => void;
  onError?: (e: object) => void;
  onReauthNeeded?: (hubId: string) => void;
  onChannelsUpdated?: (hubId: string) => void;
  /** The hub dropped events for this socket (broadcast lag) — resync. */
  onLagged?: (hubId: string) => void;
  /** Hub name/icon/settings changed (e.g. a rename via hub admin). */
  onHubUpdated?: (hubId: string) => void;
  onMemberOnline?: (publicKey: string, hubId: string) => void;
  onMemberOffline?: (publicKey: string, hubId: string) => void;
  onMemberUpdated?: (
    publicKey: string,
    displayName: string | null,
    avatar: string | null,
    nameColor: string | null,
    hubId: string,
  ) => void;
  /** Presence status changed: status is null (online), "away", or "dnd". */
  onMemberStatus?: (
    publicKey: string,
    status: string | null,
    custom: string | null,
    hubId: string,
  ) => void;
  onBotApp?: (e: object) => void;
  /** Hub-pushed voice_move (events.md §7.1) — targeted-by-pubkey, like whisper. */
  onVoiceMove?: (e: object) => void;
  /** voice-transport-v2.md E2E key distribution — a peer's key offer for us. */
  onVoiceKeyReceived?: (e: object) => void;
  /** A newcomer needs our current voice key; reply with a one-bundle offer. */
  onVoiceKeyRequest?: (e: object) => void;
}

const BACKOFF_INITIAL = 1000;
const BACKOFF_CAP = 30_000;
const REAUTH_AFTER_FAILURES = 3;

export class HubWebSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoff = BACKOFF_INITIAL;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  /** Rolling round-trip samples in ms; the window size lives in
   *  connectionStats.ts. Kept here because the socket owns the probe. */
  private rttSamples: number[] = [];
  /** Outbound voice loss as the relay last reported it, or null when this hub
   *  does not report it or we are not sending voice. Latest value rather than a
   *  window: the hub already accumulates over the session. */
  private outboundLossPct: number | null = null;
  private pingTimer: number | null = null;
  private pendingChunkEnvelope: { stream_id: string; is_init: boolean } | null = null;

  constructor(
    private hub_url: string,
    private token: string,
    private hub_id: string,
    private handlers: WsHandlers,
  ) {
    this.connect();
  }

  private get wsUrl(): string {
    const base = this.hub_url
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://");
    return `${base}/ws?token=${encodeURIComponent(this.token)}`;
  }

  private connect(): void {
    if (this.closed) return;
    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.backoff = BACKOFF_INITIAL;
      this.consecutiveFailures = 0;
      this.handlers.onStatusChange?.(true, this.hub_id);
      this.startProbing();
    };

    this.ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        if (this.pendingChunkEnvelope) {
          this.handlers.onScreenShareChunk?.(
            this.pendingChunkEnvelope.stream_id,
            this.pendingChunkEnvelope.is_init,
            ev.data,
          );
          this.pendingChunkEnvelope = null;
        }
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      this.dispatch(msg);
    };

    this.ws.onclose = () => {
      this.stopProbing();
      this.pendingChunkEnvelope = null;
      this.handlers.onStatusChange?.(false, this.hub_id);
      if (!this.closed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.pendingChunkEnvelope = null;
      this.ws?.close();
    };
  }

  private dispatch(msg: Record<string, unknown>): void {
    const tagged: Record<string, unknown> = { ...msg, _hub_id: this.hub_id };
    const type = tagged.type as string | undefined;
    if (type === "message" || type === "message_edited" || type === "message_deleted" || type === "reactions_updated" || type === "forum_event") {
      this.handlers.onMessage?.(tagged);
    } else if (type === "dm") {
      this.handlers.onDm?.(tagged);
    } else if (type === "dm_member_changed") {
      this.handlers.onDmMemberChanged?.(tagged);
    } else if (type === "typing" || type === "dm_typing") {
      this.handlers.onTyping?.(tagged);
    } else if (type === "voice_whisper_started" || type === "voice_whisper_stopped") {
      // Whisper started/stopped carry only sender_pubkey (no channel_id).
      this.handlers.onWhisper?.(tagged);
    } else if (
      type === "video_participant_enabled" || type === "video_participant_disabled" || type === "video_participants" ||
      type === "video_offer_in" || type === "video_answer_in" || type === "video_ice_in"
    ) {
      this.handlers.onVideo?.(tagged);
    } else if (
      type === "voice_joined" || type === "voice_participant_joined" || type === "voice_participant_left" ||
      type === "voice_participant_speaking" || type === "voice_roster_update"
    ) {
      this.handlers.onVoiceState?.(tagged);
    } else if (type === "screen_share_chunk") {
      const env = tagged as unknown as { stream_id: string; is_init: boolean };
      this.pendingChunkEnvelope = { stream_id: env.stream_id, is_init: env.is_init };
    } else if (
      type === "screen_share_started" || type === "screen_share_stopped" ||
      type === "screen_share_offer_in" || type === "screen_share_answer_in" || type === "screen_share_ice_in" ||
      type === "screen_share_viewer_joined" || type === "screen_share_viewer_left" ||
      type === "stream_subscribed" || type === "stream_subscription_ended" || type === "hub_streams"
    ) {
      this.handlers.onScreenShare?.(tagged);
    } else if (type === "pong") {
      // The nonce *is* the send timestamp, so the round trip needs no table of
      // outstanding probes: subtract and done. A pong for a probe sent before
      // a reconnect simply reads as one large sample and ages out of the
      // window.
      const p = tagged as unknown as { nonce?: number; outbound_loss_pct?: number };
      if (typeof p.nonce === "number") {
        this.rttSamples = pushSample(this.rttSamples, Date.now() - p.nonce);
      }
      // Absent on a hub without the `voice.loss` capability, and absent while
      // not sending voice. Both must read as "no number", never as 0.
      this.outboundLossPct = typeof p.outbound_loss_pct === "number" ? p.outbound_loss_pct : null;
    } else if (type === "message_pinned" || type === "message_unpinned") {
      this.handlers.onPin?.(tagged);
    } else if (type === "poll_vote_updated") {
      this.handlers.onPoll?.(tagged);
    } else if (type === "soundboard_played") {
      this.handlers.onSoundboardPlayed?.(tagged);
    } else if (type === "error") {
      this.handlers.onError?.(tagged);
    } else if (type === "lagged") {
      // The hub dropped an unknown number of events of ANY kind for this
      // socket (broadcast buffer overflow) — full resync, not just channels.
      this.handlers.onLagged?.(this.hub_id);
    } else if (type === "channels_updated") {
      this.handlers.onChannelsUpdated?.(this.hub_id);
    } else if (type === "hub_updated") {
      this.handlers.onHubUpdated?.(this.hub_id);
    } else if (type === "member_online") {
      this.handlers.onMemberOnline?.(tagged.public_key as string, this.hub_id);
    } else if (type === "member_offline") {
      this.handlers.onMemberOffline?.(tagged.public_key as string, this.hub_id);
    } else if (type === "member_updated") {
      this.handlers.onMemberUpdated?.(
        tagged.public_key as string,
        (tagged.display_name as string | null) ?? null,
        (tagged.avatar as string | null) ?? null,
        (tagged.name_color as string | null) ?? null,
        this.hub_id,
      );
    } else if (type === "member_status") {
      this.handlers.onMemberStatus?.(
        tagged.public_key as string,
        (tagged.status as string | null) ?? null,
        (tagged.custom as string | null) ?? null,
        this.hub_id,
      );
    } else if (type === "bot_app_launch" || type === "bot_app_open" || type === "bot_app_close") {
      this.handlers.onBotApp?.(tagged);
    } else if (type === "voice_zone_created") {
      this.handlers.onVoiceZoneCreated?.(tagged);
    } else if (type === "voice_zone_destroyed") {
      this.handlers.onVoiceZoneDestroyed?.(tagged);
    } else if (type === "voice_position_updated") {
      this.handlers.onVoicePositionUpdated?.(tagged);
    } else if (type === "voice_zone_state") {
      this.handlers.onVoiceZoneState?.(tagged);
    } else if (type === "voice_move") {
      this.handlers.onVoiceMove?.(tagged);
    } else if (type === "voice_key_received") {
      this.handlers.onVoiceKeyReceived?.(tagged);
    } else if (type === "voice_key_request") {
      this.handlers.onVoiceKeyRequest?.(tagged);
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.consecutiveFailures += 1;
    // Past a few failures the token is the likeliest suspect, so ask for a
    // fresh one — but keep our own retry armed regardless. Re-auth is a
    // network call like any other and fails for reasons that say nothing
    // about this session: a 429 off the shared auth limiter, a hub halfway
    // through a restart. Returning here left no timer, no socket and no
    // further attempt, while the UI went on announcing "Reconnecting…" for
    // as long as the tab stayed open. A re-auth that *succeeds* calls
    // close() on this socket, which cancels the timer set just below.
    if (this.consecutiveFailures >= REAUTH_AFTER_FAILURES) {
      this.handlers.onReauthNeeded?.(this.hub_id);
    }
    this.retryTimer = setTimeout(() => {
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_CAP);
  }

  /** Resolves once this socket is open, rejects if it never gets there.
   *
   * `send` below drops anything handed to it while the socket is still
   * CONNECTING. On the app's own socket that is invisible — it has been open
   * since boot — but a socket opened *in answer to a click* has not connected
   * yet on the next microtask, and the frame goes nowhere silently. That is
   * what alliance voice did: it built a socket to the allied hub and sent
   * `voice_join` immediately, so the join could only ever time out. Anyone
   * opening a socket and sending on it straight away wants this first.
   */
  whenOpen(timeoutMs = 15_000): Promise<void> {
    const socket = this.ws;
    if (!socket) return Promise.reject(new Error("WebSocket was never created"));
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("close", onFail);
        socket.removeEventListener("error", onFail);
        fn();
      };
      const onOpen = () => done(resolve);
      const onFail = () => done(() => reject(new Error("WebSocket closed before it opened")));
      const timer = setTimeout(
        () => done(() => reject(new Error("WebSocket did not open in time"))),
        timeoutMs,
      );
      socket.addEventListener("open", onOpen);
      socket.addEventListener("close", onFail);
      socket.addEventListener("error", onFail);
    });
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Send a raw binary frame (screen-share chunk payload). The hub pairs it
  // with the immediately-preceding `screen_share_chunk` JSON envelope, so
  // callers must send() the envelope first, then sendBinary() the bytes.
  sendBinary(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  subscribeChannel(channelId: string): void {
    this.send({ type: "subscribe", channel_id: channelId });
  }

  unsubscribeChannel(channelId: string): void {
    this.send({ type: "unsubscribe", channel_id: channelId });
  }

  watchVoice(channelId: string): void {
    this.send({ type: "voice_watch", channel_id: channelId });
  }

  // --- voice-transport-v2.md: join now travels over the main WS (the hub
  // replies with `voice_joined`, carrying the WebTransport URL/token/cert
  // hash — see useVoice.handleVoiceJoin for the request/response pairing).
  joinVoice(channelId: string): void {
    this.send({ type: "voice_join", channel_id: channelId });
  }

  sendVoiceKeyOffer(channelId: string, bundles: VoiceKeyBundle[]): void {
    this.send({ type: "voice_key_offer", channel_id: channelId, bundles });
  }

  /** Reports a speech on/off edge. The hub fans it out as
   *  `voice_participant_speaking` and stamps `voice_last_active`, which is
   *  what the AFK sweep reads — so this is not only the indicator. */
  sendVoiceSpeaking(channelId: string, speaking: boolean): void {
    this.send({ type: "voice_speaking", channel_id: channelId, speaking });
  }

  /** Round-trip probe. The hub echoes `nonce` untouched, so the caller times
   *  it against its own clock and the hub keeps no state. */
  sendPing(nonce: number): void {
    this.send({ type: "ping", nonce });
  }

  /** Snapshot of the latency figures. Cheap to call — the UI polls it. */
  connectionStats(): RttStats {
    return rttStats(this.rttSamples);
  }

  /** Outbound voice loss the relay reported on the last pong, or null. */
  outboundLossPercent(): number | null {
    return this.outboundLossPct;
  }

  /** Starts probing. Called on open; the interval is cleared on close so a
   *  dropped socket stops measuring instead of piling up failed sends. */
  private startProbing(): void {
    this.stopProbing();
    const probe = () => {
      try { this.sendPing(Date.now()); } catch { /* socket not ready */ }
    };
    probe();
    this.pingTimer = setInterval(probe, PING_INTERVAL_MS) as unknown as number;
  }

  private stopProbing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // --- Camera video signaling (full-mesh WebRTC, main WS) ---
  sendVideoEnable(channelId: string): void {
    this.send({ type: "video_enable", channel_id: channelId });
  }
  sendVideoDisable(channelId: string): void {
    this.send({ type: "video_disable", channel_id: channelId });
  }
  sendVideoOffer(channelId: string, toPubkey: string, sdp: string): void {
    this.send({ type: "video_offer", channel_id: channelId, to_pubkey: toPubkey, sdp });
  }
  sendVideoAnswer(channelId: string, toPubkey: string, sdp: string): void {
    this.send({ type: "video_answer", channel_id: channelId, to_pubkey: toPubkey, sdp });
  }
  sendVideoIce(channelId: string, toPubkey: string, candidate: string): void {
    this.send({ type: "video_ice", channel_id: channelId, to_pubkey: toPubkey, candidate });
  }

  // --- Whisper control (main WS) ---
  startWhisper(targets: { type: string; id: string }[]): void {
    this.send({ type: "voice_whisper_start", targets });
  }
  stopWhisper(): void {
    this.send({ type: "voice_whisper_stop" });
  }
  // Hub-side opt-out state is ephemeral (not persisted across the hub's own
  // reconnects), so callers must re-send this on every WS (re)connect —
  // see App.tsx's onStatusChange, which does exactly that.
  setWhisperOptout(enabled: boolean): void {
    this.send({ type: "voice_whisper_optout", enabled });
  }

  // --- Voice move (main WS, events.md §7.1) — eventId is present for every
  // staging-panel move (§7.5) and omitted for the Phase-1 right-click primitive.
  sendVoiceMove(targetPubkey: string, targetChannelId: string, eventId?: string): void {
    this.send({
      type: "voice_move",
      target_pubkey: targetPubkey,
      target_channel_id: targetChannelId,
      ...(eventId ? { event_id: eventId } : {}),
    });
  }

  // --- Hub-streams (cross-channel screen-share discovery/subscribe) ---
  requestStreamList(): void {
    this.send({ type: "stream_list" });
  }
  subscribeStream(sourceChannelId: string, streamId: string): void {
    this.send({ type: "stream_subscribe", source_channel_id: sourceChannelId, stream_id: streamId });
  }
  unsubscribeStream(sourceChannelId: string, streamId: string): void {
    this.send({ type: "stream_unsubscribe", source_channel_id: sourceChannelId, stream_id: streamId });
  }

  /** Roster removal is WS-authoritative (voice-transport-v2.md): closing the
   *  WebTransport session only clears the audio handle, so this is what
   *  actually takes us out of the channel participant list. */
  leaveVoice(channelId: string): void {
    this.send({ type: "voice_leave", channel_id: channelId });
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }
}
