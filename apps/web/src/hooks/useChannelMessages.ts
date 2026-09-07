import { useEffect, useRef, useState } from "react";
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  searchMessages,
  markChannelRead,
  subscribeChannel,
} from "@platform";
import { saveDraft, loadDraft, clearDraft } from "../utils/drafts";
import type { SelectedAllianceChannel } from "./useAlliances";
import type { Channel, Message, Attachment, AllianceInfo, AllianceSharedChannel } from "@shared/types";

export interface UseChannelMessagesParams {
  activeHubId: string | null;
  setView: (v: "channels" | "dms") => void;
  // App-side navigation on entering a channel/alliance channel (deselect the
  // DM conversation) — `setSelectedConversation` itself lives in useDms,
  // which is wired to accept `setSelectedChannel` from this hook the same
  // way, so one of the two directions has to go through a callback.
  clearConversationSelection: () => void;
  clearUnread: (hubId: string, channelId: string) => void;
  selectedAllianceChannel: SelectedAllianceChannel | null;
  clearSelectedAllianceChannel: () => void;
  selectAllianceChannel: (alliance: AllianceInfo, channel: AllianceSharedChannel) => Promise<void>;
  sendAllianceMessage: (content: string) => Promise<boolean>;
  /** A message of the user's own just reached the hub. */
  onMessageSent?: () => void;
}

// Channel message state (composer, edit/reply/attachment drafts, search,
// permalink scroll-to) plus the channel-selection state it's scoped to.
// selectedChannelRef/selectedChannelIdRef are exposed for the WS handler
// registry, typing indicators, and loadHubData (which stays in App.tsx) to
// read — same ref objects every consumer already relied on before this hook
// existed.
export function useChannelMessages({
  activeHubId, setView, clearConversationSelection, clearUnread,
  selectedAllianceChannel, clearSelectedAllianceChannel, selectAllianceChannel, sendAllianceMessage,
  onMessageSent,
}: UseChannelMessagesParams) {
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const selectedChannelRef = useRef<Channel | null>(null);
  const selectedChannelIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
    selectedChannelIdRef.current = selectedChannel?.id;
  }, [selectedChannel]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [newWhileScrolledUp, setNewWhileScrolledUp] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [firstNotifyingMessageId, setFirstNotifyingMessageId] = useState<string | null>(null);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesEndChannelRef = useRef<HTMLLIElement | null>(null);
  const messagesContainerRef = useRef<HTMLOListElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectedChannel) {
      setSearchResults(null);
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await searchMessages(selectedChannel.id, q);
        if (!cancelled) setSearchResults(r);
      } catch {
        if (!cancelled) setSearchResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchQuery, selectedChannel]);

  // Scrolls to and flashes an already-loaded message row (reply-jump,
  // pinned-message jump, and the tail end of message-permalink navigation
  // once the target channel's history has loaded — nested-channels-ux.md §1.3).
  function handleScrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }

  // A channel-permalink message target may point at a channel that wasn't
  // yet selected, so the message row doesn't exist until its history loads.
  useEffect(() => {
    if (!pendingScrollMessageId) return;
    if (!messages.some((m) => m.id === pendingScrollMessageId)) return;
    const id = pendingScrollMessageId;
    setPendingScrollMessageId(null);
    requestAnimationFrame(() => handleScrollToMessage(id));
  }, [messages, pendingScrollMessageId]);

  // Give up on a pending message-permalink scroll if the target isn't in
  // the loaded history window (e.g. it's older than what's fetched).
  useEffect(() => {
    if (!pendingScrollMessageId) return;
    const timer = setTimeout(() => setPendingScrollMessageId(null), 8000);
    return () => clearTimeout(timer);
  }, [pendingScrollMessageId]);

  async function handleSelectChannel(ch: Channel) {
    setSelectedChannel(ch);
    clearConversationSelection();
    clearSelectedAllianceChannel();
    setView("channels");
    setMessages([]);
    setReplyTarget(null);
    setEditingMessageId(null);
    if (activeHubId) {
      clearUnread(activeHubId, ch.id);
      setInputText(loadDraft(`${activeHubId}/${ch.id}`));
    } else {
      setInputText("");
    }
    markChannelRead(ch.id).catch(() => {});
    // Channels created after the WS connected are not in the hub's
    // auto-subscribe set; subscribing is idempotent for the rest.
    subscribeChannel(ch.id).catch(() => {});
    try {
      const msgs = await getMessages(ch.id);
      setMessages(msgs);
      setStickToBottom(true);
      setNewWhileScrolledUp(0);
    } catch {}
  }

  function handleSelectAllianceChannel(alliance: AllianceInfo, channel: AllianceSharedChannel) {
    setSelectedChannel(null);
    clearConversationSelection();
    setView("channels");
    setInputText("");
    setReplyTarget(null);
    setEditingMessageId(null);
    void selectAllianceChannel(alliance, channel);
  }

  async function handleSendAllianceMessage() {
    if (!selectedAllianceChannel || !inputText.trim()) return;
    // Clear on success only: this used to empty the box first, so a refused
    // send (an alliance revoked, a hub down) took the message with it.
    if (await sendAllianceMessage(inputText)) setInputText("");
  }

  async function handleSend() {
    if (!selectedChannel || !inputText.trim()) return;
    const text = inputText.trim();
    setInputText("");
    if (activeHubId) clearDraft(`${activeHubId}/${selectedChannel.id}`);
    try {
      const sent = await sendMessage(selectedChannel.id, text, pendingAttachments.length ? pendingAttachments : undefined, replyTarget?.id);
      // Render what the hub stored instead of waiting for the socket to echo
      // it: a message sent while the socket is down or still reconnecting was
      // accepted (201) and then vanished from its own author view until the
      // next channel load. The id dedupe is the one the socket handler
      // already applies, so the echo is a no-op when it arrives.
      if (sent && sent.channel_id === selectedChannelIdRef.current) {
        setMessages((prev) => prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]);
      }
      setPendingAttachments([]);
      setReplyTarget(null);
      onMessageSent?.();
    } catch {
      // Nothing here can raise a toast, so put the text back rather than
      // dropping it silently — a rejected send (rate limit, hub down) left
      // the composer empty and the words gone.
      setInputText((cur) => cur || text);
    }
  }

  async function handleSaveEdit() {
    if (!editingMessageId || !editingDraft.trim() || !selectedChannel) return;
    try {
      await editMessage(selectedChannel.id, editingMessageId, editingDraft.trim());
      setEditingMessageId(null);
      setEditingDraft("");
    } catch {}
  }

  function handleCancelEdit() { setEditingMessageId(null); setEditingDraft(""); }

  function handleStartEdit(msg: Message) {
    setEditingMessageId(msg.id);
    setEditingDraft(msg.content);
  }

  async function handleDeleteMessage(msgId: string) {
    if (!selectedChannel) return;
    try {
      await deleteMessage(selectedChannel.id, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch {}
  }

  async function handleToggleReaction(msgId: string, emoji: string) {
    if (!selectedChannel) return;
    const msg = messages.find((m) => m.id === msgId);
    const existing = msg?.reactions?.find((r) => r.emoji === emoji);
    try {
      if (existing?.me) await removeReaction(selectedChannel.id, msgId, emoji);
      else await addReaction(selectedChannel.id, msgId, emoji);
    } catch {}
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    if (e.key === "Escape") { setReplyTarget(null); setEditingMessageId(null); }
  }

  function handleJumpToBottom() {
    setStickToBottom(true);
    setNewWhileScrolledUp(0);
  }

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStickToBottom(atBottom);
    if (atBottom) setNewWhileScrolledUp(0);
  }

  function handleInputTextChange(v: string) {
    setInputText(v);
    if (activeHubId && selectedChannel) saveDraft(`${activeHubId}/${selectedChannel.id}`, v);
  }

  function handleCloseSearch() {
    setSearchOpen(false);
    setSearchResults(null);
    setSearchQuery("");
  }

  return {
    selectedChannel, setSelectedChannel, selectedChannelRef, selectedChannelIdRef,
    messages, setMessages,
    inputText, setInputText,
    editingMessageId, setEditingMessageId,
    editingDraft, setEditingDraft,
    replyTarget, setReplyTarget,
    pendingAttachments, setPendingAttachments,
    stickToBottom, setStickToBottom,
    newWhileScrolledUp, setNewWhileScrolledUp,
    searchOpen, setSearchOpen,
    searchQuery, setSearchQuery,
    searchResults, setSearchResults,
    firstNotifyingMessageId, setFirstNotifyingMessageId,
    pendingScrollMessageId, setPendingScrollMessageId,
    messagesEndRef, messagesEndChannelRef, messagesContainerRef, messageInputRef,
    handleScrollToMessage,
    handleSelectChannel,
    handleSelectAllianceChannel,
    handleSendAllianceMessage,
    handleSend,
    handleSaveEdit,
    handleCancelEdit,
    handleStartEdit,
    handleDeleteMessage,
    handleToggleReaction,
    handleKeyDown,
    handleJumpToBottom,
    handleMessagesScroll,
    handleInputTextChange,
    handleCloseSearch,
  };
}

export type ChannelMessagesReturn = ReturnType<typeof useChannelMessages>;
