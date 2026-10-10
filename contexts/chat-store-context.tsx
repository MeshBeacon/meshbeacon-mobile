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
  ) => ChatMessage;
  /** Get the full message list for one peer thread. */
  getMessages: (peerId: string) => ChatMessage[];
  /**
   * Same as `getMessages` but safe to call from inside a callback created
   * once and invoked much later (e.g. a delivery-retry `setTimeout`) --
   * always reads live data instead of a snapshot frozen at closure-creation
   * time.
   */
  getMessagesLive: (peerId: string) => ChatMessage[];
  /** Clear unread badge when the user opens a thread. */
  markRead: (peerId: string) => void;
  /** Bump unread counter for a peer on incoming MTALK. */
  incrementUnread: (peerId: string) => void;
  /** Mark a sent message as delivered when a CDK:MACK receipt arrives. */
  markDelivered: (mid: string) => void;
  /** Mark a sent message as failed once the bounded auto-retry window elapses. */
  markFailed: (mid: string) => void;
  /** Reset a message's status back to "sent" when an auto/manual resend is issued. */
  markRetrying: (mid: string) => void;
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
