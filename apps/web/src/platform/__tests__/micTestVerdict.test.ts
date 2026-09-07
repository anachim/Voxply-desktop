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
