import { describe, it, expect } from "vitest";
import {
  micTestVerdict,
  effectiveVad,
  DEFAULT_SPEAKING,
  MIC_TEST_SILENCE_FLOOR,
} from "../speakingDetector";

// Gating transmission on speech (2026-08-22) turned the VAD threshold from
// something that controlled an *indicator* into something that controls
// whether anyone hears you — and the level meter kept answering the old
// question, moving happily while the gate never opened. These are the three
// answers, because they send someone to three different settings.

describe("micTestVerdict", () => {
  const standard = effectiveVad({ profile: "standard" });

  it("calls a dead stream a dead stream, not a quiet one", () => {
    expect(micTestVerdict(0, standard)).toBe("silent");
    expect(micTestVerdict(MIC_TEST_SILENCE_FLOOR / 2, standard)).toBe("silent");
  });

  it("names the case the meter alone could never show: heard, but under the gate", () => {
    const under = (DEFAULT_SPEAKING.threshold + MIC_TEST_SILENCE_FLOOR) / 2;
    expect(under).toBeGreaterThan(MIC_TEST_SILENCE_FLOOR);
    expect(under).toBeLessThan(DEFAULT_SPEAKING.threshold);
    expect(micTestVerdict(under, standard)).toBe("below_gate");
  });

  it("is satisfied once the gate is crossed", () => {
    expect(micTestVerdict(DEFAULT_SPEAKING.threshold, standard)).toBe("ok");
    expect(micTestVerdict(0.5, standard)).toBe("ok");
  });

  it("answers against the threshold actually in force, not the default", () => {
    // Someone who raised their own sensitivity is judged by their own gate.
    const strict = effectiveVad({ profile: "custom", customVad: true, customVadThreshold: 0.2 });
    expect(micTestVerdict(0.1, strict)).toBe("below_gate");
    expect(micTestVerdict(0.1, standard)).toBe("ok");
  });

  it("says nothing where there is no gate", () => {
    // Music transmits continuously, so "you are below the gate" would be a
    // sentence about a gate that is not there.
    expect(micTestVerdict(0, effectiveVad({ profile: "music" }))).toBeNull();
    expect(
      micTestVerdict(0, effectiveVad({ profile: "custom", customVad: false })),
    ).toBeNull();
  });
});

// The setting that decides audibility, and the two clients disagreed on it:
// desktop's `effective_config` reads `vad_threshold` under the standard
// profile, web's `effectiveVad` ignored it and always used the constant — while
// its own doc comment claimed to mirror desktop. So a sensitivity someone set
// did nothing until they also switched profile, and the slider was reachable
// only from inside the custom panel.
describe("effectiveVad and the two thresholds", () => {
  it("honours the general sensitivity under standard, as desktop always has", () => {
    expect(effectiveVad({ profile: "standard", vadThreshold: 0.08 })).toEqual({
      enabled: true,
      threshold: 0.08,
    });
  });

  it("falls back to the constant when nothing was set", () => {
    expect(effectiveVad({ profile: "standard" }).threshold).toBe(DEFAULT_SPEAKING.threshold);
    expect(effectiveVad().threshold).toBe(DEFAULT_SPEAKING.threshold);
  });

  it("lets the custom profile override it, and inherits it when it does not", () => {
    expect(
      effectiveVad({ profile: "custom", vadThreshold: 0.08, customVadThreshold: 0.15 }).threshold,
    ).toBe(0.15);
    // The Rust is `custom_vad_threshold.or(vad_threshold)` — inheriting, not
    // resetting to the constant, which would undo a setting made outside.
    expect(effectiveVad({ profile: "custom", vadThreshold: 0.08 }).threshold).toBe(0.08);
  });

  it("keeps the custom VAD toggle custom-only", () => {
    expect(effectiveVad({ profile: "custom", customVad: false }).enabled).toBe(false);
    // Standard gates regardless of a toggle that belongs to another profile.
    expect(effectiveVad({ profile: "standard", customVad: false }).enabled).toBe(true);
  });

  it("still turns the gate off for music", () => {
    expect(effectiveVad({ profile: "music", vadThreshold: 0.08 }).enabled).toBe(false);
  });
});
