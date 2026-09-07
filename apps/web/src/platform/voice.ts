import OpusScript from 'opusscript';
import { hexToBytes, voicePacketSeal, voicePacketOpen } from '@wavvon/core';
import { getScoped, setScoped } from '../utils/accountScope';
import { VoiceKeyManager, type VoiceKeyBundle } from './voiceKeys';
import { parseDownlinkDatagram, peekSealedKeyId, ReplayGuard } from './voiceDatagram';
import { nextPlayoutStart } from './voicePlayout';
import { lossPercent, trackPacket, type LossTracker } from './connectionStats';
import {
  DEFAULT_SPEAKING,
  INITIAL_SPEAKING_STATE,
  frameEnergy,
  nextSpeakingState,
  effectiveVad,
  type SpeakingState,
} from './speakingDetector';

export interface VoiceZoneAttenuation {
  model: 'linear' | 'inverse_square' | 'step' | 'exponential';
  max_radius: number;
  ref_dist: number;
  rolloff: number;
}

export interface VoiceZone {
  zone_id: string;
  name: string;
  coordinate_system: string;
  attenuation: VoiceZoneAttenuation;
  positions: Record<string, number[]>;
}

export function computeAttenuation(dist: number, cfg: VoiceZoneAttenuation): number {
  if (dist >= cfg.max_radius) return 0;
  const t = dist / cfg.max_radius;
  switch (cfg.model) {
    case 'linear':
      return 1 - t;
    case 'inverse_square': {
      const d = Math.max(dist, cfg.ref_dist);
      return Math.min(1, (cfg.ref_dist / d) ** 2);
    }
    case 'step':
      return dist <= cfg.ref_dist ? 1 : 0;
    case 'exponential':
      return Math.exp(-cfg.rolloff * t);
    default:
      return 1;
  }
}

export interface VoiceSessionHandlers {
  /** `channelId` is the room the join actually landed in — for a spawner
   *  join this is the newly-spawned sibling room, not the channel id the
   *  caller passed to the constructor. */
  onReady: (senderId: number, participants: unknown[], channelId: string) => void;
  onClose: () => void;
  /** Send a `voice_key_offer` over the MAIN hub WS (voice-transport-v2.md
   *  "E2E key distribution") — the WebTransport session has no signaling
   *  channel of its own, only datagrams. */
  sendKeyOffer: (channelId: string, bundles: VoiceKeyBundle[]) => void;
  /** Called only when speech starts or stops, never per frame. */
  sendSpeaking: (channelId: string, speaking: boolean) => void;
}

/** What `voice_join` gets back from the hub (the `voice_joined` reply) —
 *  everything the session needs to open its WebTransport connection and
 *  seed the initial key exchange, gathered by the caller (useVoice) before
 *  constructing a session. */
export interface VoiceJoinInfo {
  channelId: string;
  senderId: number;
  participants: { sender_id: number; public_key: string }[];
  wtUrl: string;
  token: string;
  certHash: string | null;
}

export interface AudioProfileConfig {
  profile: 'standard' | 'music' | 'custom';
  customBitrate?: number | null;
  customApp?: 'voip' | 'audio' | 'lowdelay';
  customNoiseSuppress?: boolean;
  customVad?: boolean;
  /** Sensitivity under every gating profile; customVadThreshold overrides it
   *  inside custom only. Without this the engine could not see a threshold
   *  set outside the custom panel — see effectiveVad. */
  vadThreshold?: number;
  customVadThreshold?: number;
  customChannels?: 1 | 2;
  customFrameMs?: 20 | 40 | 60;
  customComplexity?: number;
}

interface OpusCodec {
  encode(buffer: Uint8Array, frameSize: number): Uint8Array;
  decode(buffer: Uint8Array): Uint8Array;
  delete(): void;
}

const OPUS_FRAME_SIZE = 960; // 20 ms at 48 kHz
const GAINS_STORAGE_KEY = 'wavvon.voice_gains';

/** Playback cursor into a decoded soundboard clip mid-mix (soundboard.md
 *  §1: the clip rides the sender's own outgoing stream). */
export interface ActiveClip {
  samples: Float32Array;
  pos: number;
}

/** Pure sample-add mix of a mic capture frame with whatever's left of an
 *  in-flight soundboard clip, clamped to the valid float PCM range so a
 *  loud clip under a loud mic can't wrap around instead of just clipping.
 *  Called once per `onaudioprocess` frame, ahead of Opus encoding, so the
 *  clip is baked into the *outgoing* stream rather than played locally. */
export function mixClipIntoFrame(
  micFrame: Float32Array,
  clip: ActiveClip | null,
): { output: Float32Array; nextClip: ActiveClip | null } {
  const output = new Float32Array(micFrame.length);
  const samples = clip?.samples;
  let pos = clip?.pos ?? 0;

  for (let i = 0; i < micFrame.length; i++) {
    let sample = micFrame[i];
    if (samples && pos < samples.length) {
      sample += samples[pos];
      pos++;
    }
    output[i] = Math.max(-1, Math.min(1, sample));
  }

  const nextClip = samples && pos < samples.length ? { samples, pos } : null;
  return { output, nextClip };
}

/** Averages N channel buffers down to mono. Opus (and this mixer) only
 *  deals in mono at 48 kHz; a stereo clip is folded down before mixing. */
export function downmixChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}

export class VoiceWtSession {
  private transport: WebTransport | null = null;
  private datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private datagramReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private encoder: OpusCodec | null = null;
  private decoder: OpusCodec | null = null;
  private timestamp = 0;
  private muted = false;
  private deafened = false;
  private closed = false;
  private sampleAccum = new Int16Array(OPUS_FRAME_SIZE);
  private sampleAccumLen = 0;
  private gainNodes: Map<number, GainNode> = new Map();
  private senderIdToPubkey: Map<number, string> = new Map();
  /** Per-sender playout clock: when that sender's last scheduled
   *  frame ends. Cleared when they leave, so a rejoin does not
   *  inherit a stale future timestamp and start out silent. */
  private playoutEnd: Map<number, number> = new Map();
  private speakingState: SpeakingState = INITIAL_SPEAKING_STATE;
  /** Per-sender inbound loss trackers, keyed by sender id. Fed from the
   *  cleartext `ctr` in each packet header, so gaps are visible without
   *  decrypting anything. */
  private lossBySender: Map<number, LossTracker> = new Map();
  private savedGains: Record<string, number>;
  private zones: Map<string, VoiceZone> = new Map();
  private myPubkey: string;
  private activeClip: ActiveClip | null = null;
  private activeClipId: string | null = null;
  private channelId: string;
  private keys: VoiceKeyManager;
  private replayGuard = new ReplayGuard();

  constructor(
    private join: VoiceJoinInfo,
    private handlers: VoiceSessionHandlers,
    private audioConfig?: AudioProfileConfig,
    myPubkey?: string,
    ownSeedHex?: string,
    private fetchDhKey: (pubkey: string) => Promise<string | null> = async () => null,
    // See VoiceKeyManager: resolveDmSendAttribution(identity).dhPriv — the
    // canonical DH scalar on a paired device, seed-derived otherwise.
    ownDhPriv?: Uint8Array,
  ) {
    this.myPubkey = myPubkey ?? "";
    this.channelId = join.channelId;
    this.keys = new VoiceKeyManager(join.channelId, ownSeedHex ?? "", this.fetchDhKey, ownDhPriv);
    this.handleRosterUpdate(join.participants);
    try {
      this.savedGains = JSON.parse(getScoped(GAINS_STORAGE_KEY) || '{}') as Record<string, number>;
    } catch {
      this.savedGains = {};
    }
  }

  async start(): Promise<void> {
    let opusApp = OpusScript.Application.VOIP;
    let channels = 1;

    if (this.audioConfig) {
      if (this.audioConfig.profile === 'music') {
        opusApp = OpusScript.Application.AUDIO;
        channels = 2;
      } else if (this.audioConfig.profile === 'custom') {
        const appMap = {
          voip: OpusScript.Application.VOIP,
          audio: OpusScript.Application.AUDIO,
          lowdelay: OpusScript.Application.RESTRICTED_LOWDELAY,
        };
        opusApp = appMap[this.audioConfig.customApp ?? 'voip'];
        channels = this.audioConfig.customChannels ?? 1;
      }
    }

    this.encoder = new OpusScript(48000, channels, opusApp, { wasm: false }) as unknown as OpusCodec;
    this.decoder = new OpusScript(48000, 1, OpusScript.Application.VOIP, { wasm: false }) as unknown as OpusCodec;

    // Honor the user's chosen input device (Settings → Voice), if any.
    let inputId: string | null = null;
    try { inputId = localStorage.getItem("wavvon.audioInputDevice"); } catch { /* ignore */ }
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: inputId ? { deviceId: { exact: inputId } } : true,
    });

    this.audioCtx = new AudioContext({ sampleRate: 48000 });
    // Route playback to the chosen output device where supported (Chrome 110+).
    try {
      const outputId = localStorage.getItem("wavvon.audioOutputDevice");
      const ctx = this.audioCtx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (outputId && typeof ctx.setSinkId === "function") {
        await ctx.setSinkId(outputId).catch(() => { /* device gone — fall back to default */ });
      }
    } catch { /* setSinkId unsupported */ }
    const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => this.onAudioProcess(e);
    source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);

    const url = `${this.join.wtUrl}?token=${encodeURIComponent(this.join.token)}`;
    const certHash = this.join.certHash;
    const options: WebTransportOptions | undefined = certHash
      // Re-wrap: hexToBytes's declared `Uint8Array` return type erases the
      // `ArrayBuffer` (vs `ArrayBufferLike`) generic BufferSource needs.
      ? { serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(hexToBytes(certHash)) }] }
      : undefined;
    this.transport = new WebTransport(url, options);
    await this.transport.ready;
    this.datagramWriter = this.transport.datagrams.writable.getWriter();
    this.datagramReader = this.transport.datagrams.readable.getReader();
    void this.readLoop();
    this.transport.closed.then(() => {
      if (!this.closed) this.handlers.onClose();
    }).catch(() => {
      if (!this.closed) this.handlers.onClose();
    });

    // Seal outgoing frames with our own key from the moment capture starts —
    // no need to wait on the (async, network-bound) key offer below, since
    // sealing only needs the locally-generated key.
    const others = this.join.participants
      .filter((p) => p.public_key !== this.myPubkey)
      .map((p) => p.public_key);
    void this.offerKeyTo(others);

    this.handlers.onReady(this.join.senderId, this.join.participants, this.join.channelId);
  }

  private async readLoop(): Promise<void> {
    const reader = this.datagramReader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.onDatagram(value);
      }
    } catch { /* transport closed — `.closed` above drives teardown */ }
  }

  private onDatagram(data: Uint8Array): void {
    if (this.deafened || !this.decoder) return;

    const frame = parseDownlinkDatagram(data);
    if (!frame) return;
    const senderPubkey = this.senderIdToPubkey.get(frame.senderId);
    if (!senderPubkey) return;

    let opened: { ctr: bigint; ts: number; opus: Uint8Array };
    try {
      const keyId = peekSealedKeyId(frame.sealed);
      const remoteKey = this.keys.lookupKey(senderPubkey, keyId);
      if (!remoteKey) return; // unknown (sender, key_id) — drop silently
      opened = voicePacketOpen(remoteKey.key, remoteKey.salt, frame.sealed);
      if (!this.replayGuard.accept(frame.senderId, keyId, opened.ctr)) return;
    } catch {
      return;
    }

    let pcm: Uint8Array;
    try {
      pcm = this.decoder.decode(opened.opus);
    } catch {
      return;
    }

    this.lossBySender.set(
      frame.senderId,
      trackPacket(this.lossBySender.get(frame.senderId), opened.ctr),
    );

    this.playPcm(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2), frame.senderId);
  }

  /** Wraps our current own key for each target and sends it as one
   *  `voice_key_offer` — used at join (all other participants), on a
   *  `voice_key_request` for a single newcomer, and after a leave-triggered
   *  rotation. Best-effort: a target whose DH key can't be resolved is
   *  silently skipped by the key manager. */
  private async offerKeyTo(targets: string[]): Promise<void> {
    if (targets.length === 0) return;
    try {
      const bundles = await this.keys.buildOffer(targets);
      if (bundles.length > 0) this.handlers.sendKeyOffer(this.channelId, bundles);
    } catch { /* best-effort */ }
  }

  /** `voice_key_received` (main WS) — store the sender's key. */
  handleKeyReceived(fromPubkey: string, ciphertextHex: string, nonceHex: string): void {
    void this.keys.receiveKey(fromPubkey, ciphertextHex, nonceHex);
  }

  /** `voice_key_request` (main WS) — a newcomer needs our current key. */
  handleKeyRequest(newPubkey: string): void {
    void this.offerKeyTo([newPubkey]);
  }

  /** `voice_participant_left` (main WS) — rotate and re-offer to whoever
   *  remains (read off our own roster map, minus the departed member and
   *  ourselves), so the departed member's cached key goes stale. */
  handleParticipantLeft(leftPubkey: string): void {
    const remaining = [...new Set(this.senderIdToPubkey.values())]
      .filter((pk) => pk !== leftPubkey && pk !== this.myPubkey);
    void this.rotateAndReoffer(remaining);
  }

  private async rotateAndReoffer(remainingPubkeys: string[]): Promise<void> {
    try {
      const bundles = await this.keys.rotate(remainingPubkeys);
      if (bundles.length > 0) this.handlers.sendKeyOffer(this.channelId, bundles);
    } catch { /* best-effort */ }
  }

  private onAudioProcess(e: AudioProcessingEvent): void {
    if (this.muted || !this.datagramWriter || !this.encoder) return;

    const micFrame = e.inputBuffer.getChannelData(0);

    // Speech detection runs on the raw mic frame, before the soundboard mix:
    // a clip playing through our own stream is not us talking.
    this.updateSpeaking(micFrame);

    const { output, nextClip } = mixClipIntoFrame(micFrame, this.activeClip);
    this.activeClip = nextClip;
    if (!this.activeClip) this.activeClipId = null;

    // "Enable voice activity detection (drops silence)" is what the settings
    // label promises, and until now nothing read the toggle: the web engine
    // transmitted every frame, silence included. Hold the datagram back while
    // there is nothing to send.
    //
    // A playing soundboard clip counts, and has to be tested separately:
    // `updateSpeaking` runs on the raw mic frame on purpose, so a clip never
    // reads as speech, and gating on speech alone would silence the
    // soundboard. Safe for receivers by construction -- `ctr` only advances on
    // a send, so a gap is not counted as inbound loss, and the playout clock
    // rebuilds its lead after one (voicePlayout.ts).
    const silenceGated = !this.speakingState.speaking && !this.activeClip;

    let offset = 0;

    while (offset < output.length) {
      const space = OPUS_FRAME_SIZE - this.sampleAccumLen;
      const take = Math.min(space, output.length - offset);
      for (let i = 0; i < take; i++) {
        this.sampleAccum[this.sampleAccumLen + i] = Math.max(-32768, Math.min(32767, output[offset + i] * 32767));
      }
      this.sampleAccumLen += take;
      offset += take;

      if (this.sampleAccumLen === OPUS_FRAME_SIZE) {
        let opusBytes: Uint8Array;
        try {
          opusBytes = this.encoder.encode(new Uint8Array(this.sampleAccum.buffer), OPUS_FRAME_SIZE);
        } catch {
          this.sampleAccumLen = 0;
          return;
        }

        // The encoder ran either way: it carries state between frames, and
        // starving it through a silence would make the first frame after one
        // pop. Only the send is skipped.
        if (!silenceGated) {
          const ownKey = this.keys.ownKey();
          const sealed = voicePacketSeal(ownKey.key, ownKey.salt, ownKey.keyId, this.keys.nextCtr(), this.timestamp, opusBytes);
          this.datagramWriter.write(sealed).catch(() => {});
        }
        // Advanced whether or not the frame went out: `timestamp` is a media
        // clock, and the desktop pipeline advances it through suppressed
        // frames too. `ctr` is the opposite -- it counts packets actually
        // sent, so it must only move inside the branch above or receivers
        // would read the silence as inbound loss.
        this.timestamp += OPUS_FRAME_SIZE;
        this.sampleAccumLen = 0;
      }
    }
  }

  private getOrCreateGainNode(senderId: number): GainNode {
    const existing = this.gainNodes.get(senderId);
    if (existing) return existing;

    const gainNode = this.audioCtx!.createGain();
    const pubkey = this.senderIdToPubkey.get(senderId);
    if (pubkey && this.savedGains[pubkey] !== undefined) {
      gainNode.gain.value = this.savedGains[pubkey] / 100;
    } else {
      gainNode.gain.value = 1.0;
    }
    gainNode.connect(this.audioCtx!.destination);
    this.gainNodes.set(senderId, gainNode);
    return gainNode;
  }

  /** Advances the speech detector and reports only the on/off edges.
   *
   *  Muted counts as not speaking regardless of what the mic hears: we are
   *  sending no audio, so claiming otherwise would light our name up in
   *  everyone's member list while they hear silence. */
  private updateSpeaking(micFrame: Float32Array): void {
    const vad = effectiveVad(this.audioConfig);

    // VAD off: we transmit continuously, so anything but a steady "speaking"
    // would be a lie about what the other end is hearing. One edge, no
    // release — the desktop pipeline's else-branch does the same.
    if (!vad.enabled) {
      if (!this.speakingState.speaking) {
        this.speakingState = { speaking: true, lastLoudAt: Date.now() };
        this.handlers.sendSpeaking(this.channelId, true);
      }
      return;
    }

    const energy = this.muted ? 0 : frameEnergy(micFrame);
    const next = nextSpeakingState(this.speakingState, energy, Date.now(), {
      threshold: vad.threshold,
      holdMs: DEFAULT_SPEAKING.holdMs,
    });
    if (next.speaking !== this.speakingState.speaking) {
      this.handlers.sendSpeaking(this.channelId, next.speaking);
    }
    this.speakingState = next;
  }

  /** Worst inbound loss across the senders we are hearing, as a percentage,
   *  or null when nothing has been received long enough to judge. The worst
   *  rather than the average: one badly-reaching participant is the thing you
   *  want to see, and averaging it against three clean streams hides it. */
  inboundLossPercent(): number | null {
    let worst: number | null = null;
    for (const tracker of this.lossBySender.values()) {
      const pct = lossPercent(tracker);
      if (pct === null) continue;
      if (worst === null || pct > worst) worst = pct;
    }
    return worst;
  }

  private playPcm(pcm: Int16Array, senderId: number): void {
    if (!this.audioCtx) return;
    const buffer = this.audioCtx.createBuffer(1, pcm.length, 48000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      channel[i] = pcm[i] / 32767;
    }
    const src = this.audioCtx.createBufferSource();
    src.buffer = buffer;
    const gainNode = this.getOrCreateGainNode(senderId);
    src.connect(gainNode);

    // Scheduled, not `start()`. See voicePlayout.ts: playing each frame the
    // instant it arrives is gapless only when arrival is gapless, which is
    // true on a loopback and false across the internet.
    const at = nextPlayoutStart(this.playoutEnd.get(senderId), this.audioCtx.currentTime);
    src.start(at);
    this.playoutEnd.set(senderId, at + pcm.length / 48000);
  }

  handleRosterUpdate(participants: { sender_id: number; public_key: string }[]): void {
    const activeIds = new Set(participants.map((p) => p.sender_id));

    for (const [sid] of this.senderIdToPubkey) {
      if (!activeIds.has(sid)) {
        this.lossBySender.delete(sid);
        const gainNode = this.gainNodes.get(sid);
        if (gainNode) {
          gainNode.disconnect();
          this.gainNodes.delete(sid);
        }
        this.senderIdToPubkey.delete(sid);
        this.playoutEnd.delete(sid);
      }
    }

    for (const p of participants) {
      this.senderIdToPubkey.set(p.sender_id, p.public_key);
    }
  }

  handleZoneState(_channelId: string, zones: VoiceZone[]): void {
    this.zones.clear();
    for (const z of zones) this.zones.set(z.zone_id, z);
    this.recomputeAllProximityGains();
  }

  handleZoneCreated(msg: { zone_id: string; name: string; coordinate_system: string; attenuation: VoiceZoneAttenuation }): void {
    this.zones.set(msg.zone_id, { ...msg, positions: {} });
  }

  handleZoneDestroyed(zoneId: string): void {
    this.zones.delete(zoneId);
    this.recomputeAllProximityGains();
  }

  handlePositionUpdated(zoneId: string, pubkey: string, position: number[]): void {
    const z = this.zones.get(zoneId);
    if (!z) return;
    z.positions[pubkey] = position;
    this.recomputeAllProximityGains();
  }

  setMyPosition(zoneId: string, position: number[]): void {
    const z = this.zones.get(zoneId);
    if (!z) return;
    z.positions[this.myPubkey] = position;
    this.recomputeAllProximityGains();
  }

  private recomputeAllProximityGains(): void {
    for (const [senderId, pubkey] of this.senderIdToPubkey) {
      let proximityGain = 1.0;

      for (const zone of this.zones.values()) {
        const senderPos = zone.positions[pubkey];
        const myPos = zone.positions[this.myPubkey];
        if (!senderPos || !myPos) continue;

        const dist = Math.sqrt(
          senderPos.reduce((acc, v, i) => acc + (v - (myPos[i] ?? 0)) ** 2, 0)
        );
        proximityGain = Math.min(proximityGain, computeAttenuation(dist, zone.attenuation));
      }

      const manualGainPct = this.savedGains[pubkey] ?? 100;
      const effective = Math.min(200, Math.max(0, manualGainPct * proximityGain));
      const gainNode = this.gainNodes.get(senderId);
      if (gainNode) gainNode.gain.value = effective / 100;
    }
  }

  setSenderGain(pubkey: string, gainPct: number): void {
    const clamped = Math.max(0, Math.min(200, gainPct));
    const gainValue = clamped / 100;

    const stored = { ...this.savedGains };
    if (Math.abs(gainValue - 1.0) < 0.001) {
      delete stored[pubkey];
    } else {
      stored[pubkey] = clamped;
    }
    this.savedGains = stored;
    try {
      setScoped(GAINS_STORAGE_KEY, JSON.stringify(stored));
    } catch {}

    for (const [sid, pk] of this.senderIdToPubkey) {
      if (pk === pubkey) {
        const gainNode = this.gainNodes.get(sid);
        if (gainNode) {
          gainNode.gain.value = gainValue;
        }
        break;
      }
    }
  }

  /** Decodes a soundboard clip's Opus-in-Ogg bytes to mono PCM at this
   *  session's sample rate via the browser's native Opus decoder, ready to
   *  hand to `playClip`. Requires the session to be started (needs a live
   *  AudioContext). */
  async decodeClipPcm(bytes: ArrayBuffer): Promise<Float32Array> {
    if (!this.audioCtx) throw new Error('Voice session is not active');
    const buffer = await this.audioCtx.decodeAudioData(bytes.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    return downmixChannels(channels);
  }

  /** Queues decoded clip PCM to be mixed into the next outgoing audio
   *  frames (soundboard.md §1). Returns false without side effects if a
   *  clip is already playing — the client-side "one clip at a time" rule
   *  that keeps a spam-triggered clip from stacking a wall of overlapping
   *  audio into the caller's own stream. */
  playClip(clipId: string, samples: Float32Array): boolean {
    if (this.activeClip) return false;
    this.activeClip = { samples, pos: 0 };
    this.activeClipId = clipId;
    return true;
  }

  getPlayingClipId(): string | null {
    return this.activeClipId;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    if (deafened) this.muted = true;
  }

  stop(): void {
    this.closed = true;
    this.sampleAccumLen = 0;
    this.processor?.disconnect();
    this.processor = null;
    for (const track of this.mediaStream?.getTracks() ?? []) track.stop();
    this.mediaStream = null;
    for (const [, gainNode] of this.gainNodes) {
      gainNode.disconnect();
    }
    this.gainNodes.clear();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    try { this.datagramWriter?.close(); } catch { /* transport may already be gone */ }
    this.datagramWriter = null;
    try { this.datagramReader?.cancel(); } catch { /* transport may already be gone */ }
    this.datagramReader = null;
    try { this.transport?.close(); } catch { /* already closed */ }
    this.transport = null;
    this.encoder?.delete();
    this.decoder?.delete();
    this.encoder = null;
    this.decoder = null;
  }
}
