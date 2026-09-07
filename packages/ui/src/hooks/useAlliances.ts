import { useState } from "react";
import type { AllianceInfo, AllianceSharedChannel, Message } from "../types";
import { sendToAllianceChannel, errorText } from "../utils/allianceSend";

// The alliance axis of a hub: which alliances this hub is in, which channels
// each one shares, and — for a channel hosted on the *other* hub — reading and
// posting to it through our own hub (alliances.md).
//
// Converged from the two app copies 2026-09-07. They had split the work
// differently rather than diverged in behaviour: web kept selection and
// messages here, desktop kept them inline in useChannelMessages. Web's split
// won because the alliance IO belongs with the alliance state, and it leaves
// useChannelMessages taking the same props on both clients.
//
// One thing did NOT travel: desktop's selectAllianceChannel opened a shared
// channel as a *local* channel when its id matched one of our own. That branch
// cannot be reached — ChannelSidebar builds the alliance list as `remoteOnly`,
// filtering out exactly the channels it would have caught — so it went with
// the merge rather than into it.

export interface SelectedAllianceChannel {
  alliance_id: string;
  alliance_name: string;
  channel: AllianceSharedChannel;
}

export interface AllianceDeps {
  listAlliances: () => Promise<AllianceInfo[]>;
  listSharedChannels: (allianceId: string) => Promise<AllianceSharedChannel[]>;
  getChannelMessages: (allianceId: string, channelId: string) => Promise<Message[]>;
  sendChannelMessage: (allianceId: string, channelId: string, content: string) => Promise<void>;
  /** Shown to the user. Both clients pass their own error surface. */
  onError: (message: string) => void;
}

export interface AlliancesReturn {
  userAlliances: AllianceInfo[];
  setUserAlliances: React.Dispatch<React.SetStateAction<AllianceInfo[]>>;
  allianceChannels: Record<string, AllianceSharedChannel[]>;
  setAllianceChannels: React.Dispatch<React.SetStateAction<Record<string, AllianceSharedChannel[]>>>;
  selectedAllianceChannel: SelectedAllianceChannel | null;
  setSelectedAllianceChannel: React.Dispatch<React.SetStateAction<SelectedAllianceChannel | null>>;
  allianceMessages: Message[];
  setAllianceMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  loadAlliances: () => Promise<void>;
  selectAllianceChannel: (alliance: AllianceInfo, channel: AllianceSharedChannel) => Promise<void>;
  clearSelectedAllianceChannel: () => void;
  /** True if the hub took the message. Callers own the composer, and a false
   *  here is what keeps a failed send's text in it — desktop did that and web
   *  cleared the box first, losing the message on any error. */
  sendAllianceMessage: (content: string) => Promise<boolean>;
}

export function useAlliances(deps: AllianceDeps): AlliancesReturn {
  const [userAlliances, setUserAlliances] = useState<AllianceInfo[]>([]);
  const [allianceChannels, setAllianceChannels] = useState<Record<string, AllianceSharedChannel[]>>({});
  const [selectedAllianceChannel, setSelectedAllianceChannel] = useState<SelectedAllianceChannel | null>(null);
  const [allianceMessages, setAllianceMessages] = useState<Message[]>([]);

  async function loadAlliances() {
    let list: AllianceInfo[];
    try {
      list = await deps.listAlliances();
    } catch (e) {
      // Empty is the right thing to render — an alliance we cannot list is
      // one we cannot use — but it is also what "this hub has no alliances"
      // looks like, so the reason has to go somewhere. Not onError: this runs
      // on every hub load, and a hub predating alliances answers 404.
      console.warn("[alliances] could not list alliances:", e);
      setUserAlliances([]);
      setAllianceChannels({});
      return;
    }

    setUserAlliances(list);
    const byId: Record<string, AllianceSharedChannel[]> = {};
    await Promise.all(
      list.map(async (a) => {
        try {
          byId[a.id] = await deps.listSharedChannels(a.id);
        } catch (e) {
          console.warn(`[alliances] could not list shared channels of ${a.id}:`, e);
          byId[a.id] = [];
        }
      }),
    );
    setAllianceChannels(byId);
  }

  function clearSelectedAllianceChannel() {
    setSelectedAllianceChannel(null);
    setAllianceMessages([]);
  }

  async function selectAllianceChannel(alliance: AllianceInfo, channel: AllianceSharedChannel) {
    setSelectedAllianceChannel({
      alliance_id: alliance.id,
      alliance_name: alliance.name,
      channel,
    });
    setAllianceMessages([]);
    try {
      setAllianceMessages(await deps.getChannelMessages(alliance.id, channel.channel_id));
    } catch (e) {
      deps.onError(errorText(e));
    }
  }

  async function sendAllianceMessage(content: string): Promise<boolean> {
    if (!selectedAllianceChannel) return false;
    const { alliance_id, channel } = selectedAllianceChannel;
    const { ok, messages } = await sendToAllianceChannel(
      {
        send: (text) => deps.sendChannelMessage(alliance_id, channel.channel_id, text),
        refresh: () => deps.getChannelMessages(alliance_id, channel.channel_id),
        onError: deps.onError,
      },
      content,
    );
    if (messages) setAllianceMessages(messages);
    return ok;
  }

  return {
    userAlliances,
    setUserAlliances,
    allianceChannels,
    setAllianceChannels,
    selectedAllianceChannel,
    setSelectedAllianceChannel,
    allianceMessages,
    setAllianceMessages,
    loadAlliances,
    selectAllianceChannel,
    clearSelectedAllianceChannel,
    sendAllianceMessage,
  };
}

