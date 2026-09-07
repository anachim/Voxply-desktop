import { useMemo, useRef } from "react";
import { useAlliances as useSharedAlliances } from "@wavvon/ui";
import {
  listAlliances,
  listAllianceSharedChannels,
  getAllianceChannelMessages,
  sendAllianceChannelMessage,
} from "@platform";

export type { SelectedAllianceChannel, AlliancesReturn } from "@wavvon/ui";

// Web's half of the shared alliance hook: the platform calls, and nothing
// else. The state and the flow live in packages/ui.
export function useAlliances(setError: (msg: string) => void) {
  // App.tsx passes an inline arrow, so memoising on it would rebuild the deps
  // every render. Read through a ref: it is only ever called.
  const onError = useRef(setError);
  onError.current = setError;

  const deps = useMemo(
    () => ({
      listAlliances,
      listSharedChannels: listAllianceSharedChannels,
      getChannelMessages: getAllianceChannelMessages,
      sendChannelMessage: async (allianceId: string, channelId: string, content: string) => {
        await sendAllianceChannelMessage(allianceId, channelId, content);
      },
      onError: (message: string) => onError.current(message),
    }),
    [],
  );

  return useSharedAlliances(deps);
}
