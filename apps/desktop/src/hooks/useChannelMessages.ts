import { useState, useRef, useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { mentionsName, playMentionPing } from "@wavvon/core";
import { saveDraft, loadDraft, clearDraft } from "../utils/drafts";
import { readFileAsB64 } from "../utils/files";
import { MAX_ATTACHMENT_BYTES } from "../constants";
import type { SelectedAllianceChannel } from "@wavvon/ui";
import type { Channel, Message, Attachment, AllianceInfo, AllianceSharedChannel, NotifyMode, PresenceStatus } from "../types";

export interface ChannelMessagesParams {
  activeHubIdRef: RefObject<string | null>;
  publicKeyRef: RefObject<string | null>;
  myDisplayNameRef: RefObject<string | null>;
  channelsRef: RefObject<Channel[]>;
  hubsRef: RefObject<{ hub_id: string; hub_name: string }[]>;
  selectedChannelIdRef: RefObject<string | null>;
  myPresenceRef: RefObject<{ status: PresenceStatus }>;
  effectiveNotifyMode: (hubId: string, channelId: string) => NotifyMode;
  bumpUnread: (hubId: string, channelId: string) => void;
  clearUnread: (hubId: string, channelId: string) => void;
  setFirstNotify: (hubId: string, channelId: string, messageId: string) => void;
  clearFirstNotify: (hubId: string, channelId: string) => void;
  clearAllTyping: () => void;
  setError: (msg: string) => void;
  setToast: (msg: string) => void;
  // The alliance axis lives in useAlliances (packages/ui) on both clients;
  // this hook only wires it to the composer and the channel selection.
  selectedAllianceChannel: SelectedAllianceChannel | null;
  allianceMessages: Message[];
  setSelectedAllianceChannel: React.Dispatch<React.SetStateAction<SelectedAllianceChannel | null>>;
  setAllianceMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  clearSelectedAllianceChannel: () => void;
  selectSharedAllianceChannel: (alliance: AllianceInfo, ch: AllianceSharedChannel) => Promise<void>;
  sendAllianceMessage: (content: string) => Promise<boolean>;
}

export interface ChannelMessagesReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  inputText: string;
  setInputText: (v: string) => void;
  pendingAttachments: Attachment[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  replyTarget: Message | null;
  setReplyTarget: React.Dispatch<React.SetStateAction<Message | null>>;
  editingMessageId: string | null;
  editingDraft: string;
  setEditingDraft: React.Dispatch<React.SetStateAction<string>>;
  stickToBottom: boolean;
  setStickToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  newWhileScrolledUp: number;
  setNewWhileScrolledUp: React.Dispatch<React.SetStateAction<number>>;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchResults: Message[] | null;
  setSearchResults: React.Dispatch<React.SetStateAction<Message[] | null>>;
  searchOpen: boolean;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedChannel: Channel | null;
  selectedAllianceChannel: SelectedAllianceChannel | null;
  allianceMessages: Message[];
  mentionPingEnabled: boolean;
  setMentionPingEnabled: (v: boolean) => void;
  selectChannel: (channel: Channel) => Promise<void>;
  selectAllianceChannel: (alliance: AllianceInfo, ch: AllianceSharedChannel) => Promise<void>;
  clearSelectedChannel: () => void;
  setSelectedAllianceChannel: React.Dispatch<React.SetStateAction<SelectedAllianceChannel | null>>;
  setAllianceMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  handleSend: () => Promise<void>;
  handleSendAllianceMessage: () => Promise<void>;
  startEditingMessage: (m: Message) => void;
  cancelEditingMessage: () => void;
  handleSaveEditedMessage: () => Promise<void>;
  handleDeleteMessage: (messageId: string) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  attachFiles: (files: FileList | null) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  scrollToMessage: (id: string) => void;
  closeSearch: () => void;
  handleMessagesScroll: () => void;
  jumpToBottom: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  messagesEndChannelRef: React.RefObject<HTMLLIElement | null>;
  messagesContainerRef: React.RefObject<HTMLOListElement | null>;
  messageInputRef: React.RefObject<HTMLInputElement | null>;
  stickToBottomRef: React.RefObject<boolean>;
  selectedChannelForTypingRef: React.RefObject<Channel | null>;
}

type PendingNotifEntry = {
  hubName: string;
  channels: Map<string, { name: string; count: number; isMention: boolean }>;
  timer: ReturnType<typeof setTimeout>;
};

export function useChannelMessages({
  activeHubIdRef,
  publicKeyRef,
  myDisplayNameRef,
  channelsRef,
  hubsRef,
  selectedChannelIdRef,
  myPresenceRef,
  effectiveNotifyMode,
  bumpUnread,
  clearUnread,
  setFirstNotify,
  clearFirstNotify,
  clearAllTyping,
  setError,
  setToast,
  selectedAllianceChannel,
  allianceMessages,
  setSelectedAllianceChannel,
  setAllianceMessages,
  clearSelectedAllianceChannel,
  selectSharedAllianceChannel,
  sendAllianceMessage,
}: ChannelMessagesParams): ChannelMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputTextState] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [stickToBottom, setStickToBottom] = useState(true);
  const stickToBottomRef = useRef(true);
  const [newWhileScrolledUp, setNewWhileScrolledUp] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  const [mentionPingEnabled, setMentionPingEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem("wavvon.mentionPing") !== "0"; } catch { return true; }
  });
  const mentionPingRef = useRef(mentionPingEnabled);

  function setMentionPingEnabled(v: boolean) {
    setMentionPingEnabledState(v);
    mentionPingRef.current = v;
    try { localStorage.setItem("wavvon.mentionPing", v ? "1" : "0"); } catch {}
  }

  function setInputText(v: string) {
    setInputTextState(v);
  }

  useEffect(() => {
    stickToBottomRef.current = stickToBottom;
  }, [stickToBottom]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesEndChannelRef = useRef<HTMLLIElement>(null);
  const messagesContainerRef = useRef<HTMLOListElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const selectedChannelForTypingRef = useRef<Channel | null>(null);

  useEffect(() => {
    selectedChannelForTypingRef.current = selectedChannel;
  }, [selectedChannel]);

  useEffect(() => {
    if (stickToBottom) {
      (messagesEndChannelRef.current ?? messagesEndRef.current)?.scrollIntoView({ behavior: "smooth" });
      setNewWhileScrolledUp(0);
    } else {
      setNewWhileScrolledUp((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    setStickToBottom(true);
    setNewWhileScrolledUp(0);
    if (selectedChannel) {
      setTimeout(() => messageInputRef.current?.focus(), 0);
    }
  }, [selectedChannel?.id]);

  useEffect(() => {
    if (!selectedChannel) { setSearchResults(null); return; }
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await invoke<Message[]>("search_messages", { channelId: selectedChannel.id, query: q });
        if (!cancelled) setSearchResults(r);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery, selectedChannel]);

  const pendingNotifsRef = useRef<Map<string, PendingNotifEntry>>(new Map());

  function flushNotif(hubId: string) {
    const entry = pendingNotifsRef.current.get(hubId);
    if (!entry) return;
    pendingNotifsRef.current.delete(hubId);
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const channelList = [...entry.channels.values()];
    const totalCount = channelList.reduce((n, c) => n + c.count, 0);
    const hasMention = channelList.some((c) => c.isMention);
    let title: string;
    let body: string;
    if (channelList.length === 1) {
      const ch = channelList[0];
      title = hasMention ? `Mentioned in #${ch.name}` : `New messages in #${ch.name}`;
      body = `${totalCount} new message${totalCount > 1 ? "s" : ""} in ${entry.hubName}`;
    } else {
      const names = channelList.map((c) => `#${c.name}`).join(", ");
      title = hasMention ? `Mentions in ${entry.hubName}` : `New messages in ${entry.hubName}`;
      body = `${totalCount} new message${totalCount > 1 ? "s" : ""} in ${names}`;
    }
    try { new Notification(title, { body }); } catch {}
  }

  function queueNotif(hubId: string, hubName: string, channelId: string, channelName: string, isMention: boolean) {
    const map = pendingNotifsRef.current;
    const existing = map.get(hubId);
    if (existing) {
      clearTimeout(existing.timer);
      const ch = existing.channels.get(channelId);
      if (ch) {
        ch.count += 1;
        ch.isMention = ch.isMention || isMention;
      } else {
        existing.channels.set(channelId, { name: channelName, count: 1, isMention });
      }
      existing.timer = setTimeout(() => flushNotif(hubId), 3000);
    } else {
      const channels = new Map<string, { name: string; count: number; isMention: boolean }>();
      channels.set(channelId, { name: channelName, count: 1, isMention });
      map.set(hubId, {
        hubName,
        channels,
        timer: setTimeout(() => flushNotif(hubId), 3000),
      });
    }
  }

  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    (async () => {
      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; message: Message }>(
          "chat-message",
          (event) => {
            const { hub_id, channel_id, message } = event.payload;
            if (!channelsRef.current.some((c) => c.id === channel_id)) return;
            const isActiveHub = hub_id === activeHubIdRef.current;
            const isActiveChannel = isActiveHub && channel_id === selectedChannelIdRef.current;
            const myName = myDisplayNameRef.current;
            const isMention =
              !!myName &&
              message.sender !== publicKeyRef.current &&
              mentionsName(message.content, myName);
            const mode = effectiveNotifyMode(hub_id, channel_id);
            const allowBump = mode === "all" || (mode === "mentions" && isMention);
            if (isActiveChannel) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === message.id)) return prev;
                return [...prev, message];
              });
            } else if (allowBump) {
              bumpUnread(hub_id, channel_id);
              setFirstNotify(hub_id, channel_id, message.id);
            }
            // Read-time gate: "dnd" presence (global) suppresses the ping
            // and system notification but unreads still accumulate above.
            // Hub/channel "silent" notify mode is already covered by allowBump.
            const shouldNotify =
              allowBump &&
              !isActiveChannel &&
              myPresenceRef.current?.status !== "dnd" &&
              (isMention || (mode === "all" && !document.hasFocus()));
            if (shouldNotify) {
              if (mentionPingRef.current) playMentionPing();
              const channelName = channelsRef.current.find((c) => c.id === channel_id)?.name ?? channel_id;
              const hubEntry = hubsRef.current.find((h) => h.hub_id === hub_id);
              const hubName = hubEntry?.hub_name ?? hub_id;
              queueNotif(hub_id, hubName, channel_id, channelName, isMention);
            }
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; message: Message }>(
          "chat-message-edited",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            if (event.payload.channel_id !== selectedChannelIdRef.current) return;
            setMessages((prev) =>
              prev.map((m) => m.id === event.payload.message.id ? event.payload.message : m)
            );
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; message_id: string }>(
          "chat-message-deleted",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            if (event.payload.channel_id !== selectedChannelIdRef.current) return;
            setMessages((prev) => prev.filter((m) => m.id !== event.payload.message_id));
          }
        )
      );

      unlistens.push(
        await listen<{
          hub_id: string;
          channel_id: string;
          message_id: string;
          reactions: { emoji: string; count: number; me: boolean }[];
        }>("chat-reactions-updated", (event) => {
          if (event.payload.hub_id !== activeHubIdRef.current) return;
          if (event.payload.channel_id !== selectedChannelIdRef.current) return;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.payload.message_id) return m;
              const myEmojis = new Set(
                (m.reactions ?? []).filter((r) => r.me).map((r) => r.emoji)
              );
              return {
                ...m,
                reactions: event.payload.reactions.map((r) => ({ ...r, me: myEmojis.has(r.emoji) })),
              };
            })
          );
        })
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; post_id: string }>(
          "post-created",
          (event) => {
            const { hub_id, channel_id } = event.payload;
            if (!channelsRef.current.some((c) => c.id === channel_id)) return;
            const mode = effectiveNotifyMode(hub_id, channel_id);
            if (mode !== "silent" && hub_id !== activeHubIdRef.current || channel_id !== selectedChannelIdRef.current) {
              bumpUnread(hub_id, channel_id);
            }
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; post_id: string }>(
          "reply-created",
          (event) => {
            const { hub_id, channel_id } = event.payload;
            if (!channelsRef.current.some((c) => c.id === channel_id)) return;
            const mode = effectiveNotifyMode(hub_id, channel_id);
            if (mode !== "silent" && (hub_id !== activeHubIdRef.current || channel_id !== selectedChannelIdRef.current)) {
              bumpUnread(hub_id, channel_id);
            }
          }
        )
      );
    })();
    return () => { unlistens.forEach((u) => u()); };
  }, []);

  async function selectChannel(channel: Channel) {
    if (selectedChannel && selectedChannel.id !== channel.id) {
      await invoke("unsubscribe_channel", { channelId: selectedChannel.id });
    }
    clearSelectedAllianceChannel();
    closeSearch();
    setSelectedChannel(channel);
    setMessages([]);
    clearAllTyping();
    const hubId = activeHubIdRef.current;
    if (hubId) {
      clearUnread(hubId, channel.id);
      setInputText(loadDraft(`${hubId}/${channel.id}`));
    } else {
      setInputText("");
    }
    try {
      const msgs = await invoke<Message[]>("get_messages", { channelId: channel.id });
      setMessages(msgs);
      await invoke("subscribe_channel", { channelId: channel.id });
    } catch (e) {
      setError(String(e));
    }
  }

  function clearSelectedChannel() {
    setSelectedChannel(null);
    setMessages([]);
  }

  async function selectAllianceChannel(alliance: AllianceInfo, ch: AllianceSharedChannel) {
    // Desktop subscribes per channel, so leaving one is an explicit step —
    // this is the platform half that stays here while the alliance half went
    // to the shared hook. (A branch that opened a shared channel as a local
    // one went with the merge: ChannelSidebar lists only channels with no
    // local match, so it could never fire.)
    if (selectedChannel) {
      await invoke("unsubscribe_channel", { channelId: selectedChannel.id });
      setSelectedChannel(null);
    }
    await selectSharedAllianceChannel(alliance, ch);
  }

  async function handleSend() {
    if (!selectedChannel) return;
    const content = inputText;
    const attachments = pendingAttachments;
    const reply = replyTarget;
    if (!content.trim() && attachments.length === 0) return;
    setInputText("");
    const hubId = activeHubIdRef.current;
    if (hubId) clearDraft(`${hubId}/${selectedChannel.id}`);
    setPendingAttachments([]);
    setReplyTarget(null);
    try {
      const msg = await invoke<Message>("send_message", {
        channelId: selectedChannel.id,
        content,
        attachments,
        replyTo: reply?.id ?? null,
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    } catch (e) {
      setError(String(e));
      setInputText(content);
      setPendingAttachments(attachments);
      setReplyTarget(reply);
    }
  }

  async function handleSendAllianceMessage() {
    if (!selectedAllianceChannel || !inputText.trim()) return;
    if (await sendAllianceMessage(inputText)) setInputText("");
  }

  function startEditingMessage(m: Message) {
    setEditingMessageId(m.id);
    setEditingDraft(m.content);
  }

  function cancelEditingMessage() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  async function handleSaveEditedMessage() {
    if (!editingMessageId || !selectedChannel) return;
    const content = editingDraft.trim();
    if (!content) return;
    try {
      const updated = await invoke<Message>("edit_message", {
        channelId: selectedChannel.id,
        messageId: editingMessageId,
        content,
      });
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      cancelEditingMessage();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (!selectedChannel) return;
    if (!confirm("Delete this message?")) return;
    try {
      await invoke("delete_message", { channelId: selectedChannel.id, messageId });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!selectedChannel) return;
    let optimisticMine = false;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = m.reactions ? [...m.reactions] : [];
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        if (idx === -1) {
          reactions.push({ emoji, count: 1, me: true });
          optimisticMine = true;
        } else {
          const r = reactions[idx];
          if (r.me) {
            const next = { ...r, count: r.count - 1, me: false };
            if (next.count <= 0) reactions.splice(idx, 1);
            else reactions[idx] = next;
          } else {
            reactions[idx] = { ...r, count: r.count + 1, me: true };
            optimisticMine = true;
          }
        }
        return { ...m, reactions };
      })
    );
    try {
      if (optimisticMine) {
        await invoke("add_reaction", { channelId: selectedChannel.id, messageId, emoji });
      } else {
        await invoke("remove_reaction", { channelId: selectedChannel.id, messageId, emoji });
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: Attachment[] = [...pendingAttachments];
    let totalBytes = next.reduce((n, a) => n + a.data_b64.length, 0);
    for (const f of Array.from(files)) {
      try {
        const b64 = await readFileAsB64(f);
        if (totalBytes + b64.length > MAX_ATTACHMENT_BYTES) {
          setError(`Attachments would exceed 3MB cap (already at ${(totalBytes / 1_000_000).toFixed(1)}MB)`);
          break;
        }
        totalBytes += b64.length;
        next.push({ name: f.name, mime: f.type || "application/octet-stream", data_b64: b64 });
      } catch (e) {
        setError(String(e));
      }
    }
    setPendingAttachments(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function scrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 120;
    if (atBottom !== stickToBottom) setStickToBottom(atBottom);
    if (atBottom && newWhileScrolledUp > 0) setNewWhileScrolledUp(0);
    if (atBottom && activeHubIdRef.current && selectedChannel) {
      clearFirstNotify(activeHubIdRef.current, selectedChannel.id);
    }
  }

  function jumpToBottom() {
    const el = messagesContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
    setNewWhileScrolledUp(0);
  }

  return {
    messages,
    setMessages,
    inputText,
    setInputText,
    pendingAttachments,
    setPendingAttachments,
    replyTarget,
    setReplyTarget,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    stickToBottom,
    setStickToBottom,
    newWhileScrolledUp,
    setNewWhileScrolledUp,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchOpen,
    setSearchOpen,
    selectedChannel,
    selectedAllianceChannel,
    setSelectedAllianceChannel,
    allianceMessages,
    setAllianceMessages,
    mentionPingEnabled,
    setMentionPingEnabled,
    selectChannel,
    clearSelectedChannel,
    selectAllianceChannel,
    handleSend,
    handleSendAllianceMessage,
    startEditingMessage,
    cancelEditingMessage,
    handleSaveEditedMessage,
    handleDeleteMessage,
    toggleReaction,
    attachFiles,
    handleKeyDown,
    scrollToMessage,
    closeSearch,
    handleMessagesScroll,
    jumpToBottom,
    messagesEndRef,
    messagesEndChannelRef,
    messagesContainerRef,
    messageInputRef,
    stickToBottomRef,
    selectedChannelForTypingRef,
  };
}
