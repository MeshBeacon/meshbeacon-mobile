import { createContext, useContext, type ReactNode } from "react";

import { useChatStore, type ChatMessage } from "@/hooks/use-chat-store";

interface ChatStoreCtx {
  messages: ChatMessage[];
  loaded: boolean;
  targetPeer: string;
  setTargetPeer: (peer: string) => void;
  addSent: (
    text: string,
    location?: { latitude: number; longitude: number },
  ) => ChatMessage;
  addReceived: (
    text: string,
    coords?: { lat: string; lng: string },
  ) => ChatMessage;
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
