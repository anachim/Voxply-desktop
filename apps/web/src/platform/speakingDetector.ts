// Local speech detection, for the speaking indicator and the AFK sweep.
//
// The hub cannot do this for us any more, and that is by design: voice v2
// encrypts every packet end to end and the relay forwards headers only, so it
// cannot tell speech from silence. It already has the whole chain built —
// `voice_speaking` (client → hub) becomes `voice_participant_speaking`
// (hub → everyone), which the web client turns into `voiceActiveUsers` and
// UserListGrouped renders. No client ever sent the first message, so the chain
// was dead at the first link.
//
// Two things depended on it. The indicator, which simply never appeared, and
// `voice_last_active` — stamped on join and on every `voice_speaking` — which
// drives the AFK worker. With nothing reporting speech, a hub with an AFK
// channel configured moved *everyone* out once the timeout passed, however
// much they were talking.

/** Root-mean-square amplitude of a capture frame, in 0..1. */
export function frameEnergy(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export interface SpeakingState {
  speaking: boolean;
  /** Timestamp (ms) when the frame energy last exceeded the threshold. */
  lastLoudAt: number;
}

export interface SpeakingOptions {
  /** Energy above which a frame counts as speech. Defaults to the value the
   *  voice settings have always exposed as `customVadThreshold`. */
  threshold: number;
  /** How long the signal must stay quiet before speaking turns off. Without
   *  this the indicator would strobe on every pause between words. */
  holdMs: number;
}

export const DEFAULT_SPEAKING: SpeakingOptions = { threshold: 0.02, holdMs: 400 };

export interface EffectiveVad {
  /** When false the mic transmits continuously and we report speaking from
   *  the first frame on, with no release. */
  enabled: boolean;
  threshold: number;
}

/**
 * Resolve the audio profile into the VAD settings actually in force.
 *
 * Mirrors `effective_config` in the desktop pipeline
 * (`crates/voice/src/pipeline.rs`), which has **two** thresholds and not one:
 * `vadThreshold` is the sensitivity that applies whatever profile you are on,
 * and `customVadThreshold` overrides it inside the custom profile only. Music
 * turns VAD off entirely, because a continuous instrument is exactly what a
 * silence gate cuts up.
 *
 * This used to claim it mirrored that function while the standard profile
 * ignored the user's threshold and always used the constant — so the one
 * setting that decides whether anyone hears you did different things on the
 * two clients, and web's sensitivity slider was reachable only by switching
 * to the custom profile (docs `next-up.md`, the VAD known issue). Fixed
 * 2026-09-07 by taking desktop's model, which is the one a visible control
 * implies.
 */
export function effectiveVad(cfg?: {
  profile?: 'standard' | 'music' | 'custom';
  customVad?: boolean;
  /** Applies under every profile that gates at all. */
  vadThreshold?: number;
  /** Custom-profile override of the above. */
  customVadThreshold?: number;
}): EffectiveVad {
  const base = cfg?.vadThreshold ?? DEFAULT_SPEAKING.threshold;
  if (cfg?.profile === 'music') {
    return { enabled: false, threshold: base };
  }
  if (cfg?.profile === 'custom') {
    return {
      enabled: cfg.customVad ?? true,
      // `.or()` in the Rust: the custom value when set, the general one
      // otherwise — not the constant, which would quietly undo a sensitivity
      // the user set outside the panel.
      threshold: cfg.customVadThreshold ?? base,
    };
  }
  return { enabled: true, threshold: base };
}

export const INITIAL_SPEAKING_STATE: SpeakingState = { speaking: false, lastLoudAt: 0 };

/**
 * Advance the detector by one capture frame.
 *
 * Asymmetric on purpose: speech starts the instant a frame is loud enough, so
 * the indicator feels immediate, and stops only after `holdMs` of quiet, so it
 * does not flicker between syllables. The caller sends a `voice_speaking`
 * message only when `speaking` actually flips — at 50 frames a second,
 * reporting every frame would be a message storm for a boolean.
 */
export function nextSpeakingState(
  prev: SpeakingState,
  energy: number,
  now: number,
  opts: SpeakingOptions = DEFAULT_SPEAKING,
): SpeakingState {
  if (energy > opts.threshold) return { speaking: true, lastLoudAt: now };
  if (!prev.speaking) return prev;
  if (now - prev.lastLoudAt >= opts.holdMs) return { speaking: false, lastLoudAt: prev.lastLoudAt };
  return prev;
}

/** Below this an RMS is the room, not a voice — a muted mic, the wrong
 *  device, a browser that granted a dead stream. */
export const MIC_TEST_SILENCE_FLOOR = 0.002;

export type MicTestVerdict = "silent" | "below_gate" | "ok";

/**
 * What to tell someone who just tested their microphone.
 *
 * Three different problems sit behind "nobody can hear me" and they send the
 * user to three different places, so guessing wastes the trip: no signal at
 * all is a device or a permission, a signal that never reaches the gate is
 * the sensitivity (and the reason the level meter alone was not enough — it
 * moves cheerfully while transmission never opens), and crossing the gate
 * means the problem is somewhere else entirely.
 *
 * `null` when there is nothing to say yet: still measuring, or a profile with
 * no gate at all (music transmits continuously).
 */
export function micTestVerdict(peakRms: number, vad: EffectiveVad): MicTestVerdict | null {
  if (!vad.enabled) return null;
  if (peakRms < MIC_TEST_SILENCE_FLOOR) return "silent";
  if (peakRms < vad.threshold) return "below_gate";
  return "ok";
}
