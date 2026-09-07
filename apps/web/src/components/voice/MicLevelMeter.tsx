import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { effectiveVad, micTestVerdict } from "../../platform/speakingDetector";

// A "test your mic" level meter: opens its own microphone stream, runs it
// through an AnalyserNode, and animates a bar from the RMS level. Fully
// client-side (no hub involvement); ported from the desktop MicLevelMeter.
// The stream is opened only while testing and always released on stop.
interface Props {
  /** The audio profile in force, so the meter can show the level at which
   *  this user actually starts transmitting. Omitted: the standard gate. */
  audioProfile?: {
    profile?: "standard" | "music" | "custom";
    customVad?: boolean;
    customVadThreshold?: number;
  };
}

/** Long enough that someone who pressed Start and said something has said it,
 *  short enough to still be about the sentence they just spoke. */
const VERDICT_AFTER_MS = 4000;

export function MicLevelMeter({ audioProfile }: Props = {}) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0); // 0..1
  const [error, setError] = useState<string | null>(null);
  /** Loudest raw RMS seen this run — raw, because the gate compares raw RMS
   *  while the bar below shows a scaled version of it. */
  const [peak, setPeak] = useState(0);
  const [longEnough, setLongEnough] = useState(false);
  const verdictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  function stop() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    if (verdictTimer.current !== null) clearTimeout(verdictTimer.current);
    verdictTimer.current = null;
    setLevel(0);
    setPeak(0);
    setLongEnough(false);
    setTesting(false);
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      setTesting(true);
      setPeak(0);
      setLongEnough(false);
      verdictTimer.current = setTimeout(() => setLongEnough(true), VERDICT_AFTER_MS);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        // RMS around the 128 midpoint → 0..1.
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        setLevel(Math.min(1, rms * 2.5));
        setPeak((prev) => (rms > prev ? rms : prev));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stop();
    }
  }

  // Always release the mic when the component unmounts.
  useEffect(() => () => stop(), []);

  const pct = Math.round(level * 100);

  // The bar shows rms * 2.5, so the gate has to be drawn on the same scale to
  // sit where the bar will actually reach it.
  const vad = effectiveVad(audioProfile);
  const gatePct = Math.min(100, vad.threshold * 2.5 * 100);

  // Only once there has been time to speak, and only about what was heard.
  // Three different problems, and sending someone to the wrong one wastes the
  // trip: nothing arriving at all is a device, arriving-but-under-the-gate is
  // the sensitivity, and crossing it is nothing.
  const verdict = testing && longEnough ? micTestVerdict(peak, vad) : null;

  return (
    <div className="settings-section" style={{ marginTop: 16 }}>
      <label className="settings-label">{t("settings.voice.mic_test.label")}</label>
      <div className="settings-row" style={{ alignItems: "center", gap: 12 }}>
        <button type="button" onClick={testing ? stop : start}>
          {testing ? t("settings.voice.mic_test.stop") : t("settings.voice.mic_test.start")}
        </button>
        <div
          role="meter"
          aria-label={t("settings.voice.mic_test.level_aria")}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            flex: 1,
            height: 12,
            borderRadius: 6,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: level > 0.8 ? "var(--danger)" : "var(--accent)",
              transition: "width 60ms linear",
            }}
          />
          {vad.enabled && (
            // Where transmission starts. Without it the bar answers "is my mic
            // working", which was never the question someone nobody can hear
            // is asking.
            <div
              aria-hidden="true"
              title={t("settings.voice.mic_test.gate_title")}
              style={{
                position: "absolute",
                left: `${gatePct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: "var(--text-muted)",
              }}
            />
          )}
        </div>
      </div>
      {error && <p className="error-text" style={{ fontSize: "var(--text-sm)" }}>{error}</p>}
      {testing && verdict === null && (
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
          {t("settings.voice.mic_test.speak")}
        </p>
      )}
      {verdict === "silent" && (
        <p className="error-text" style={{ fontSize: "var(--text-sm)" }}>
          {t("settings.voice.mic_test.no_signal")}
        </p>
      )}
      {verdict === "below_gate" && (
        <p className="error-text" style={{ fontSize: "var(--text-sm)" }}>
          {t("settings.voice.mic_test.below_gate")}
        </p>
      )}
      {verdict === "ok" && (
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
          {t("settings.voice.mic_test.above_gate")}
        </p>
      )}
    </div>
  );
}
