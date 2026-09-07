import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import {
  activeSession, getSession, sendSetStatusTo, hubFetch, reauthorizeHub,
  refreshHubInfo, listHubs, fetchVoiceRoster, fetchAllUsers,
} from "@platform";
import type { WsHandlers } from "@platform";
import { mentionsName, playMentionPing } from "@wavvon/core";
import type { Channel, Message, User, Hub, MeInfo, VoiceParticipant, NotifyMode } from "@shared/types";
import type { BotAppLaunchEvent, BotAppOpenEvent, PresenceStatus } from "../types";

export interface UseWsHandlersParams {
  activeHubIdRef: RefObject<string | null>;
  hubsRef: RefObject<Hub[]>;
  selectedChannelRef: RefObject<Channel | null>;
  meInfoRef: RefObject<MeInfo | null>;
  publicKeyRef: RefObject<string | null>;
  myPresenceRef: RefObject<{ status: PresenceStatus }>;
  effectiveNotifyModeRef: RefObject<(hubId: string, channelId: string) => NotifyMode>;
  mentionPingEnabledRef: RefObject<boolean>;
  whisperOptoutRef: RefObject<boolean>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setStickToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  setNewWhileScrolledUp: React.Dispatch<React.SetStateAction<number>>;
  bumpUnread: (hubId: string, channelId: string) => void;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  setHubs: React.Dispatch<React.SetStateAction<Hub[]>>;
  setActiveHubTimezone: React.Dispatch<React.SetStateAction<string | null>>;
  setVoicePartByChannel: React.Dispatch<React.SetStateAction<Record<string, VoiceParticipant[]>>>;
  onDm: (raw: unknown) => void;
  onDmMemberChanged: (raw: unknown) => void;
  receiveTyping: (raw: Record<string, unknown>) => void;
  onScreenShare: (raw: unknown) => void;
  onScreenShareChunk: (streamId: string, isInit: boolean, data: ArrayBuffer) => void;
  receiveSoundboardPlayed: (raw: unknown) => void;
  handleStatusChange: (hubId: string, hubName: string, connected: boolean, setAssertive: (msg: string) => void) => void;
  setAssertiveAnnouncement: (msg: string) => void;
  showHubError: (msg: string) => void;
  // Function declarations are hoisted, so the frozen memo below could close
  // over loadHubData directly like the original App did — but loadHubData is
  // now a prop passed in fresh on every render, and the memo (deps []) only
  // ever sees the FIRST render's value unless read through a ref. Filled by
  // App every render (`loadHubDataRef.current = loadHubData`), same pattern
  // as stableHandlersRef below.
  loadHubDataRef: RefObject<() => Promise<void>>;
  voiceOnVoiceState: (raw: unknown) => void;
  voiceOnVoiceZoneState: (raw: unknown) => void;
  voiceOnVoiceZoneCreated: (raw: unknown) => void;
  voiceOnVoiceZoneDestroyed: (raw: unknown) => void;
  voiceOnVoicePositionUpdated: (raw: unknown) => void;
  voiceOnVoiceKeyReceived: (raw: unknown) => void;
  voiceOnVoiceKeyRequest: (raw: unknown) => void;
  handleVideoMessage: (raw: Record<string, unknown>) => void;
  receiveWhisperEvent: (senderPubkey: string, isWhisper: boolean) => void;
  onVoiceMovePush: (raw: unknown) => void;
  setActiveBotApps: React.Dispatch<React.SetStateAction<Map<string, BotAppLaunchEvent>>>;
  setActiveOpenApp: React.Dispatch<React.SetStateAction<{ event: BotAppOpenEvent; hubUrl: string } | null>>;
}

// The full WS handler registry (WsHandlers), frozen once (useMemo, deps []) so
// hub sessions opened at any point in the app's life always call the SAME
// handler object — everything it reads must be a ref, a stable setter, or a
// module-level function. `stableHandlersRef` mirrors it every render so
// onReauthNeeded (which needs the latest registry to re-authenticate with)
// always sees the current one despite being defined inside the frozen memo.
export function useWsHandlers(deps: UseWsHandlersParams) {
  const {
    activeHubIdRef, hubsRef, selectedChannelRef, meInfoRef, publicKeyRef,
    myPresenceRef, effectiveNotifyModeRef, mentionPingEnabledRef, whisperOptoutRef,
    setMessages, setStickToBottom, setNewWhileScrolledUp, bumpUnread,
    setUsers, setChannels, setHubs, setActiveHubTimezone, setVoicePartByChannel,
    onDm, onDmMemberChanged, receiveTyping, onScreenShare, onScreenShareChunk,
    receiveSoundboardPlayed, handleStatusChange, setAssertiveAnnouncement, showHubError,
    loadHubDataRef, voiceOnVoiceState, voiceOnVoiceZoneState, voiceOnVoiceZoneCreated,
    voiceOnVoiceZoneDestroyed, voiceOnVoicePositionUpdated, voiceOnVoiceKeyReceived,
    voiceOnVoiceKeyRequest, handleVideoMessage,
    receiveWhisperEvent, onVoiceMovePush, setActiveBotApps, setActiveOpenApp,
  } = deps;

  const stableHandlersRef = useRef<WsHandlers>({});
  const reauthInFlight = useRef<Set<string>>(new Set());

  const stableHandlers: WsHandlers = useMemo(() => ({
    onMessage: (raw) => {
      const m = raw as Record<string, unknown>;
      const type = m.type as string;
      const msgHubId = m._hub_id as string | undefined;
      const activeHub = activeHubIdRef.current;
      if (type === "message") {
        const msg = m.message as Message | undefined;
        if (!msg) return;
        const selCh = selectedChannelRef.current;
        const isActiveHub = msgHubId === activeHub;
        const isActiveChannel = isActiveHub && m.channel_id === selCh?.id;
        if (isActiveChannel) {
          setMessages((prev) => prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]);
          setStickToBottom((stick) => { if (stick) setNewWhileScrolledUp(0); else setNewWhileScrolledUp((n) => n + 1); return stick; });
        } else if (msgHubId && m.channel_id) {
          bumpUnread(msgHubId, m.channel_id as string);
        }
        const myName = meInfoRef.current?.display_name ?? null;
        const myPk = publicKeyRef.current;
        const isMention = (myName && mentionsName(msg.content, myName)) ||
          (myPk && msg.content.includes(myPk));
        // Read-time notification gate, two independent quiets: "dnd"
        // presence (global) and a "silent" notify mode on this hub or
        // channel (hub mute). Either way unreads still accumulate.
        const silenced = myPresenceRef.current.status === "dnd" ||
          (!!msgHubId && typeof m.channel_id === "string" &&
            effectiveNotifyModeRef.current(msgHubId, m.channel_id) === "silent");
        if (isMention && msg.sender !== myPk && !silenced) {
          if (mentionPingEnabledRef.current) {
            try { playMentionPing(); } catch { /* audio context may not be ready */ }
          }
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`${msg.sender_name ?? "Someone"} mentioned you`, {
              body: msg.content.slice(0, 100),
              tag: msg.id,
            });
          }
        }
      } else if (type === "message_edited") {
        if (msgHubId !== activeHub) return;
        if (m.channel_id !== selectedChannelRef.current?.id) return;
        const msg = m.message as Message | undefined;
        if (msg) setMessages((prev) => prev.map((x) => x.id === msg.id ? msg : x));
      } else if (type === "message_deleted") {
        if (msgHubId !== activeHub) return;
        if (m.channel_id !== selectedChannelRef.current?.id) return;
        const id = m.message_id as string;
        if (id) setMessages((prev) => prev.filter((x) => x.id !== id));
      } else if (type === "reactions_updated") {
        if (msgHubId !== activeHub) return;
        if (m.channel_id !== selectedChannelRef.current?.id) return;
        const msgId = m.message_id as string | undefined;
        const reactions = m.reactions as Message["reactions"] | undefined;
        if (msgId && reactions) {
          setMessages((prev) => prev.map((x) => {
            if (x.id !== msgId) return x;
            const myEmojis = new Set(
              (x.reactions ?? []).filter((r) => r.me).map((r) => r.emoji)
            );
            return {
              ...x,
              reactions: reactions.map((r) => ({ ...r, me: myEmojis.has(r.emoji) })),
            };
          }));
        }
      }
    },
    onDm,
    onVideo: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      handleVideoMessage(m as Record<string, unknown>);
    },
    onWhisper: (raw) => {
      const m = raw as { type?: string; sender_pubkey?: string; _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current || !m.sender_pubkey) return;
      receiveWhisperEvent(m.sender_pubkey, m.type === "voice_whisper_started");
    },
    onVoiceMove: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      onVoiceMovePush(raw);
    },
    onVoiceState: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoiceState(raw);
    },
    onTyping: (raw) => {
      receiveTyping(raw as Record<string, unknown>);
    },
    onScreenShare,
    onScreenShareChunk,
    onStatusChange: (connected, hubId) => {
      const hubName = hubsRef.current.find((h) => h.hub_id === hubId)?.hub_name ?? "hub";
      handleStatusChange(hubId, hubName, connected, setAssertiveAnnouncement);
      if (connected) {
        // Presence is global: push this device's status to the hub that
        // just (re)connected, but only if the user ever picked one here —
        // a fresh device must not stomp a status set elsewhere.
        const p = myPresenceRef.current;
        if (p.status !== "online") {
          try { sendSetStatusTo(hubId, p.status, null); } catch { /* ws not ready */ }
        }
        // Hub-side whisper opt-out is ephemeral — re-push it on every
        // (re)connect, same reasoning as the presence push above.
        try { getSession(hubId)?.ws?.setWhisperOptout(whisperOptoutRef.current); } catch { /* ws not ready */ }
      }
      if (connected && hubId === activeHubIdRef.current) {
        fetchAllUsers().then(setUsers).catch(() => {});
        try { activeSession().ws?.requestStreamList(); } catch {}
      }
    },
    onError: (raw) => {
      const m = raw as Record<string, unknown>;
      if (m._hub_id !== activeHubIdRef.current) return;
      const message = (m.message as string | undefined) ?? "An error occurred on the hub.";
      showHubError(message);
    },
    onDmMemberChanged,
    onPin: (raw) => {
      const m = raw as Record<string, unknown>;
      if (m._hub_id !== activeHubIdRef.current) return;
    },
    onPoll: (raw) => {
      const m = raw as Record<string, unknown>;
      if (m._hub_id !== activeHubIdRef.current) return;
    },
    onSoundboardPlayed: (raw) => {
      const m = raw as Record<string, unknown>;
      if (m._hub_id !== activeHubIdRef.current) return;
      receiveSoundboardPlayed(raw);
    },
    onReauthNeeded: (hubId) => {
      // The socket asks on every failed retry past its threshold, and its
      // backoff can be shorter than a handshake takes — without this guard a
      // flapping connection stacks re-auths, each one closing the socket the
      // one before it just opened.
      if (reauthInFlight.current.has(hubId)) return;
      reauthInFlight.current.add(hubId);
      reauthorizeHub(hubId, stableHandlersRef.current).then(() => {
        if (hubId === activeHubIdRef.current) void loadHubDataRef.current();
      }).catch((e) => {
        // Not fatal: the socket keeps its own retry armed (platform/ws.ts
        // scheduleReconnect), so this is one attempt lost, not the session.
        console.warn(`[ws] re-auth with ${hubId} failed, socket will retry:`, e);
      }).finally(() => {
        reauthInFlight.current.delete(hubId);
      });
    },
    onChannelsUpdated: (hubId) => {
      if (hubId !== activeHubIdRef.current) return;
      hubFetch("/channels").then((r) => r.json() as Promise<Channel[]>).then((list) => {
        setChannels(list);
      }).catch(() => {});
    },
    onLagged: (hubId) => {
      if (hubId !== activeHubIdRef.current) return;
      // An unknown number of events of any kind was dropped — resync the
      // event-maintained state that has no other healing path: channels,
      // the member roster (presence), and who's in which voice channel.
      hubFetch("/channels").then((r) => r.json() as Promise<Channel[]>).then(setChannels).catch(() => {});
      fetchAllUsers().then(setUsers).catch(() => {});
      fetchVoiceRoster().then(setVoicePartByChannel).catch(() => {});
    },
    onHubUpdated: (hubId) => {
      refreshHubInfo(hubId).then((info) => {
        if (!info) return;
        setHubs(listHubs());
        if (hubId === activeHubIdRef.current) setActiveHubTimezone(info.timezone);
      }).catch(() => {});
    },
    onMemberOnline: (publicKey, hubId) => {
      if (hubId !== activeHubIdRef.current) return;
      setUsers((prev) => {
        const known = prev.some((u) => u.public_key === publicKey);
        // A member we've never seen (joined after our initial /users load)
        // isn't in the list yet — refetch so they appear live (and resolve
        // to their name in the member list, message authors, video tiles).
        // Stamp them online in the merged result: the snapshot can race
        // their presence registration and say offline, and no further
        // member_online would arrive to correct it.
        if (!known) {
          fetchAllUsers().then((list) =>
            setUsers(list.map((u) => u.public_key === publicKey ? { ...u, online: true } : u)),
          ).catch(() => {});
          return prev;
        }
        return prev.map((u) => u.public_key === publicKey ? { ...u, online: true } : u);
      });
    },
    onMemberOffline: (publicKey, hubId) => {
      if (hubId !== activeHubIdRef.current) return;
      setUsers((prev) => prev.map((u) => u.public_key === publicKey ? { ...u, online: false } : u));
    },
    onMemberUpdated: (publicKey, displayName, avatar, nameColor, hubId) => {
      if (hubId !== activeHubIdRef.current) return;
      // Update the member's name/avatar in place so the member list and every
      // message author (names resolve from this map) refresh live. If we've
      // never seen them, refetch so they appear.
      setUsers((prev) => {
        if (!prev.some((u) => u.public_key === publicKey)) {
          fetchAllUsers().then(setUsers).catch(() => {});
          return prev;
        }
        return prev.map((u) =>
          u.public_key === publicKey ? { ...u, display_name: displayName, avatar, name_color: nameColor } : u,
        );
      });
    },
    onMemberStatus: (publicKey, status, custom, hubId) => {
      if (hubId !== activeHubIdRef.current) return;
      setUsers((prev) =>
        prev.map((u) =>
          u.public_key === publicKey ? { ...u, status, status_custom: custom } : u,
        ),
      );
    },
    onVoiceZoneState: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoiceZoneState(raw);
    },
    onVoiceZoneCreated: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoiceZoneCreated(raw);
    },
    onVoiceZoneDestroyed: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoiceZoneDestroyed(raw);
    },
    onVoicePositionUpdated: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoicePositionUpdated(raw);
    },
    onVoiceKeyReceived: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoiceKeyReceived(raw);
    },
    onVoiceKeyRequest: (raw) => {
      const m = raw as { _hub_id?: string };
      if (m._hub_id !== activeHubIdRef.current) return;
      voiceOnVoiceKeyRequest(raw);
    },
    onBotApp: (raw) => {
      const m = raw as Record<string, unknown>;
      if (m._hub_id !== activeHubIdRef.current) return;
      const type = m.type as string;
      if (type === "bot_app_launch") {
        const ev = m as unknown as BotAppLaunchEvent;
        setActiveBotApps((prev) => {
          const next = new Map(prev);
          next.set(ev.bot_id, ev);
          return next;
        });
      } else if (type === "bot_app_open") {
        const ev = m as unknown as BotAppOpenEvent;
        const hubUrl = hubsRef.current.find((h) => h.hub_id === activeHubIdRef.current)?.hub_url ?? "";
        setActiveOpenApp({ event: ev, hubUrl });
      } else if (type === "bot_app_close") {
        const botId = m.bot_id as string;
        setActiveBotApps((prev) => {
          const next = new Map(prev);
          next.delete(botId);
          return next;
        });
        setActiveOpenApp((prev) => prev?.event.bot_id === botId ? null : prev);
      }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  stableHandlersRef.current = stableHandlers;

  return { stableHandlers, stableHandlersRef };
}
