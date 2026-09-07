import { useState, useRef, useCallback, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { EncryptionWarning } from "@wavvon/ui";
import type { Conversation, DmMessage, DmMessageFull, Attachment, Hub } from "../types";


export interface DmsParams {
  publicKeyRef: RefObject<string | null>;
  activeHubIdRef: RefObject<string | null>;
  selectedConversationForTypingRef: RefObject<Conversation | null>;
  getActiveHub: () => Hub | undefined;
  getPendingAttachments: () => Attachment[];
  getInputText: () => string;
  clearInput: () => void;
  clearPendingAttachments: () => void;
  setError: (msg: string) => void;
  clearAllDmTyping: () => void;
  // DM unread lives with channel unread in the shared useUnreadCounts, not
  // here: web has always kept the two together, and one owner is what lets
  // the tray badge and the document title see the whole picture.
  unreadDms: Record<string, boolean>;
  setUnreadDms: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export interface DmsReturn {
  view: "channels" | "dms";
  setView: (v: "channels" | "dms") => void;
  viewRef: RefObject<"channels" | "dms">;
  conversations: Conversation[];
  setConversations: (updater: Conversation[] | ((prev: Conversation[]) => Conversation[])) => void;
  conversationsRef: RefObject<Conversation[]>;
  selectedConversation: Conversation | null;
  setSelectedConversation: (conv: Conversation | null) => void;
  selectedConversationIdRef: RefObject<string | null>;
  dmMessages: Record<string, DmMessage[]>;
  encryptionWarning: EncryptionWarning | null;
  setEncryptionWarning: React.Dispatch<React.SetStateAction<EncryptionWarning | null>>;
  loadConversations: () => Promise<void>;
  selectConversation: (conv: Conversation) => Promise<void>;
  startDmWith: (targetKey: string, targetHubUrl?: string | null) => Promise<void>;
  handleSendDm: () => Promise<void>;
  onDmEvent: (conversationId: string, msg: DmMessage, hubId: string) => void;
  onDmMemberChanged: (payload: {
    hub_id: string;
    conversation_id: string;
    added: string[];
    removed: string[];
  }) => void;
}

export function useDms({
  publicKeyRef,
  activeHubIdRef,
  selectedConversationForTypingRef,
  getActiveHub,
  getPendingAttachments,
  getInputText,
  clearInput,
  clearPendingAttachments,
  setError,
  clearAllDmTyping,
  unreadDms,
  setUnreadDms,
}: DmsParams): DmsReturn {
  const [view, setViewState] = useState<"channels" | "dms">("channels");
  const viewRef = useRef<"channels" | "dms">("channels");

  function setView(v: "channels" | "dms") {
    setViewState(v);
    viewRef.current = v;
  }

  const [conversations, setConversationsState] = useState<Conversation[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);

  function setConversations(updater: Conversation[] | ((prev: Conversation[]) => Conversation[])) {
    setConversationsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      conversationsRef.current = next;
      return next;
    });
  }

  const [selectedConversation, setSelectedConversationState] = useState<Conversation | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);

  function setSelectedConversation(conv: Conversation | null) {
    setSelectedConversationState(conv);
    selectedConversationIdRef.current = conv?.id ?? null;
    selectedConversationForTypingRef.current = conv;
  }

  const [dmMessages, setDmMessages] = useState<Record<string, DmMessage[]>>({});
  const [encryptionWarning, setEncryptionWarning] = useState<EncryptionWarning | null>(null);

  async function loadConversations() {
    try {
      const c = await invoke<Conversation[]>("list_conversations");
      setConversations(c);
    } catch (e) {
      setError(String(e));
    }
  }

  async function selectConversation(conv: Conversation) {
    setSelectedConversation(conv);
    clearAllDmTyping();
    setUnreadDms((prev) => {
      if (!prev[conv.id]) return prev;
      const { [conv.id]: _, ...rest } = prev;
      return rest;
    });
    try {
      const history = await invoke<DmMessageFull[]>("get_dm_messages", {
        conversationId: conv.id,
      });
      setDmMessages((prev) => ({
        ...prev,
        [conv.id]: history.map((m) => ({
          id: m.id,
          sender: m.sender,
          sender_name: m.sender_name,
          content: m.content,
          timestamp: m.created_at,
          attachments: m.attachments,
          delivery_failed: m.delivery_failed,
        })),
      }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function startDmWith(targetKey: string, targetHubUrl?: string | null) {
    try {
      const memberHubs: Record<string, string> = {};
      if (targetHubUrl) memberHubs[targetKey] = targetHubUrl;
      const conv = await invoke<Conversation>("create_conversation", {
        members: [targetKey],
        memberHubs,
      });
      setConversations((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev;
        return [...prev, conv];
      });
      await selectConversation(conv);
      setView("dms");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSendDm() {
    const convId = selectedConversationIdRef.current;
    const conv = convId ? conversationsRef.current.find((c) => c.id === convId) ?? null : null;
    if (!conv) return;

    const content = getInputText();
    const attachments = getPendingAttachments();
    if (!content.trim() && attachments.length === 0) return;

    const publicKey = publicKeyRef.current;

    const doSend = async (encryptedEnvelope?: object, groupEncryptedEnvelope?: object) => {
      clearInput();
      clearPendingAttachments();
      try {
        await invoke("send_dm", {
          conversationId: conv.id,
          content: (encryptedEnvelope || groupEncryptedEnvelope) ? undefined : content,
          attachments: attachments.length > 0 ? attachments : undefined,
          encryptedEnvelope,
          groupEncryptedEnvelope,
          // Stashed Rust-side per message id so history reloads can render
          // our own encrypted sends (a ratchet can't decrypt its own
          // envelopes). Never sent to the hub.
          plaintext: (encryptedEnvelope || groupEncryptedEnvelope) ? content : undefined,
        });
        setDmMessages((prev) => {
          const list = prev[conv.id] || [];
          return {
            ...prev,
            [conv.id]: [
              ...list,
              {
                sender: publicKey || "",
                sender_name: null,
                content,
                timestamp: Math.floor(Date.now() / 1000),
                attachments,
                is_encrypted: !!encryptedEnvelope,
              },
            ],
          };
        });
      } catch (e) {
        setError(String(e));
      }
    };

    if (conv.conv_type === "group") {
      try {
        const groupEnv = await invoke<object>("encrypt_group_dm", {
          convId: conv.id,
          content,
        });
        await doSend(undefined, groupEnv);
      } catch (e) {
        if (String(e).includes("no_sender_key")) {
          try {
            await invoke("push_group_sender_key", { convId: conv.id });
            const groupEnv = await invoke<object>("encrypt_group_dm", {
              convId: conv.id,
              content,
            });
            await doSend(undefined, groupEnv);
          } catch {
            setEncryptionWarning({
              messageKey: "dm.encryption_warning.failed",
              onCancel: () => setEncryptionWarning(null),
            });
          }
        } else {
          setEncryptionWarning({
            messageKey: "dm.encryption_warning.failed",
            onCancel: () => setEncryptionWarning(null),
          });
        }
      }
      return;
    }

    const otherKey = conv.members.find((k) => k !== publicKey);
    if (!otherKey) { await doSend(); return; }

    const activeHub = getActiveHub();
    if (!activeHub) { await doSend(); return; }

    try {
      const dhPubkey = await invoke<string | null>("fetch_dh_key", {
        pubkey: otherKey,
        hubUrl: activeHub.hub_url,
      });

      if (!dhPubkey) {
        setEncryptionWarning({
          messageKey: "dm.encryption_warning.no_key",
          onConfirm: async () => {
            setEncryptionWarning(null);
            await doSend();
          },
          onCancel: () => setEncryptionWarning(null),
        });
        return;
      }

      // DR v2, same scheme web sends. init_dr_session is idempotent — a
      // no-op when a session already exists (including one responder-inited
      // by receiving first).
      await invoke("init_dr_session", {
        convId: conv.id,
        theirDhPubHex: dhPubkey,
      });
      const envelope = await invoke<object>("encrypt_dm_dr", {
        convId: conv.id,
        content,
      });
      await doSend(envelope);
    } catch {
      setEncryptionWarning({
        messageKey: "dm.encryption_warning.failed",
        onCancel: () => setEncryptionWarning(null),
      });
    }
  }

  const onDmEvent = useCallback(
    (conversationId: string, msg: DmMessage, hubId: string) => {
      if (hubId !== activeHubIdRef.current) return;
      setDmMessages((prev) => {
        const list = prev[conversationId] || [];
        return { ...prev, [conversationId]: [...list, msg] };
      });
      const lookingHere =
        viewRef.current === "dms" &&
        selectedConversationIdRef.current === conversationId;
      if (!lookingHere && msg.sender !== publicKeyRef.current) {
        setUnreadDms((prev) => ({ ...prev, [conversationId]: true }));
      }
      const conv = conversationsRef.current.find((c) => c.id === conversationId);
      if (conv?.conv_type === "group" && msg.sender !== publicKeyRef.current) {
        invoke("fetch_group_sender_keys", { convId: conversationId })
          .then(() => invoke<DmMessageFull[]>("get_dm_messages", { conversationId }))
          .then((history) => {
            setDmMessages((prev) => ({
              ...prev,
              [conversationId]: history.map((m) => ({
                id: m.id,
                sender: m.sender,
                sender_name: m.sender_name,
                content: m.content,
                timestamp: m.created_at,
                attachments: m.attachments,
                is_encrypted: m.is_encrypted,
              })),
            }));
          })
          .catch(() => {});
      }
    },
    [activeHubIdRef, publicKeyRef]
  );

  const onDmMemberChanged = useCallback(
    (payload: {
      hub_id: string;
      conversation_id: string;
      added: string[];
      removed: string[];
    }) => {
      if (payload.hub_id !== activeHubIdRef.current) return;
      const myKey = publicKeyRef.current;
      if (myKey && payload.removed.includes(myKey)) {
        if (selectedConversationIdRef.current === payload.conversation_id) {
          setSelectedConversation(null);
        }
      }
      void loadConversations();
      void invoke("rotate_group_sender_key", {
        convId: payload.conversation_id,
      }).catch(() => {});
    },
    [activeHubIdRef, publicKeyRef]
  );

  return {
    view,
    setView,
    viewRef,
    conversations,
    setConversations,
    conversationsRef,
    selectedConversation,
    setSelectedConversation,
    selectedConversationIdRef,
    dmMessages,
    encryptionWarning,
    setEncryptionWarning,
    loadConversations,
    selectConversation,
    startDmWith,
    handleSendDm,
    onDmEvent,
    onDmMemberChanged,
  };
}
