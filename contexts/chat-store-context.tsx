import { createContext, useContext, type ReactNode } from "react";

import {
    useChatStore,
    type ChatMessage,
    type Conversation,
} from "@/hooks/use-chat-store";

interface ChatStoreCtx {
  /** All conversations sorted newest-first — use for the inbox screen. */
  conversations: Conversation[];
  loaded: boolean;
  addSent: (
    peerId: string,
    text: string,
    location?: { latitude: number; longitude: number },
    mid?: string,
  ) => ChatMessage;
  addReceived: (
    peerId: string,
    text: string,
    coords?: { lat: string; lng: string },
    encrypted?: boolean,
  ) => ChatMessage;
  /** Get the full message list for one peer thread. */
  getMessages: (peerId: string) => ChatMessage[];
  /** Clear unread badge when the user opens a thread. */
  markRead: (peerId: string) => void;
  /** Bump unread counter for a peer on incoming MTALK. */
  incrementUnread: (peerId: string) => void;
  /** Mark a sent message as delivered when a CDK:MACK receipt arrives. */
  markDelivered: (mid: string) => void;
  /** Set the encrypted flag on a sent message once the CDK:ACK,ID:MTALK confirmation arrives. */
  markEncrypted: (mid: string, encrypted: boolean) => void;
  /** Delete all messages for one peer. */
  clearThread: (peerId: string) => void;
  /** Delete every thread and wipe from disk. */
  clearAll: () => Promise<void>;
}

const Ctx = createContext<ChatStoreCtx | null>(null);

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const store = useChatStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useChatStoreCtx(): ChatStoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useChatStoreCtx must be used inside ChatStoreProvider");
  return ctx;
}
