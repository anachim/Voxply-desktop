import { useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAlliances as useSharedAlliances } from "@wavvon/ui";
import type { AllianceInfo, AllianceSharedChannel, Message } from "../types";

export type { SelectedAllianceChannel, AlliancesReturn } from "@wavvon/ui";

// Desktop's half of the shared alliance hook: the Tauri commands, and nothing
// else. Selection and messages used to live in useChannelMessages here — they
// are alliance state, so they moved in with the rest of it when the two app
// copies converged (2026-09-07).
export function useAlliances(setError: (msg: string) => void) {
  const onError = useRef(setError);
  onError.current = setError;

  const deps = useMemo(
    () => ({
      listAlliances: () => invoke<AllianceInfo[]>("list_alliances"),
      listSharedChannels: (allianceId: string) =>
        invoke<AllianceSharedChannel[]>("list_alliance_shared_channels", { allianceId }),
      getChannelMessages: (allianceId: string, channelId: string) =>
        invoke<Message[]>("get_alliance_channel_messages", { allianceId, channelId }),
      sendChannelMessage: async (allianceId: string, channelId: string, content: string) => {
        await invoke("send_alliance_channel_message", { allianceId, channelId, content });
      },
      onError: (message: string) => onError.current(message),
    }),
    [],
  );

  return useSharedAlliances(deps);
}
