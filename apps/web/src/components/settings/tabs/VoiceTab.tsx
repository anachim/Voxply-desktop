import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioProfileSection } from "@wavvon/ui";
import { MicLevelMeter } from "@components/voice/MicLevelMeter";
import { AudioDevicesSection } from "../AudioDevicesSection";
import { PushToTalkSection } from "../PushToTalkSection";

// The voice audio profile is persisted under this key; App reads it when
// joining voice, so the key and shape must stay in sync with App's reader.
const VOICE_PROFILE_KEY = "wavvon.audio_profile";

interface AudioProfileConfig {
  profile: "standard" | "music" | "custom";
  customBitrate: number | null;
  customApp: "voip" | "audio" | "lowdelay";
  customNoiseSuppress: boolean;
  customVad: boolean;
  customVadThreshold: number;
  customChannels: 1 | 2;
  customFrameMs: 20 | 40 | 60;
  customComplexity: number;
}

function loadAudioProfile(): AudioProfileConfig {
  try {
    const raw = localStorage.getItem(VOICE_PROFILE_KEY);
    if (raw) return JSON.parse(raw) as AudioProfileConfig;
  } catch {}
  return {
    profile: "standard",
    customBitrate: null,
    customApp: "voip",
    customNoiseSuppress: true,
    customVad: true,
    customVadThreshold: 0.02,
    customChannels: 1,
    customFrameMs: 20,
    customComplexity: 9,
  };
}

function saveAudioProfile(cfg: AudioProfileConfig) {
  try { localStorage.setItem(VOICE_PROFILE_KEY, JSON.stringify(cfg)); } catch {}
}

export function VoiceTab() {
  const { t } = useTranslation();
  const [audioProfile, setAudioProfile] = useState<AudioProfileConfig>(loadAudioProfile);

  function updateAudioProfile(patch: Partial<AudioProfileConfig>) {
    setAudioProfile((prev) => {
      const next = { ...prev, ...patch };
      saveAudioProfile(next);
      return next;
    });
  }

  return (
    <section>
      <h1 style={{ marginBottom: 20 }}>{t("settings.tabs.voice")}</h1>

      <h2 className="settings-subheading">{t("settings.voice.section.audio")}</h2>
      <AudioDevicesSection />
      <MicLevelMeter audioProfile={audioProfile} />
      <PushToTalkSection />

      {/* Codec/quality tuning is advanced and rarely touched — last. */}
      <AudioProfileSection
        profile={audioProfile.profile}
        onProfile={(p) => updateAudioProfile({ profile: p })}
        customBitrate={audioProfile.customBitrate}
        onCustomBitrate={(v) => updateAudioProfile({ customBitrate: v })}
        customApp={audioProfile.customApp}
        onCustomApp={(v) => updateAudioProfile({ customApp: v })}
        customNoiseSuppress={audioProfile.customNoiseSuppress}
        onCustomNoiseSuppress={(v) => updateAudioProfile({ customNoiseSuppress: v })}
        customVad={audioProfile.customVad}
        onCustomVad={(v) => updateAudioProfile({ customVad: v })}
        customVadThreshold={audioProfile.customVadThreshold}
        onCustomVadThreshold={(v) => updateAudioProfile({ customVadThreshold: v })}
        customChannels={audioProfile.customChannels}
        onCustomChannels={(v) => updateAudioProfile({ customChannels: v })}
        customFrameMs={audioProfile.customFrameMs}
        onCustomFrameMs={(v) => updateAudioProfile({ customFrameMs: v })}
        customComplexity={audioProfile.customComplexity}
        onCustomComplexity={(v) => updateAudioProfile({ customComplexity: v })}
        inVoice={false}
      />
    </section>
  );
}
