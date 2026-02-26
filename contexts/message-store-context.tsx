import { createContext, useContext, type ReactNode } from "react";

import { useMessageStore, type StoredMessage } from "@/hooks/use-message-store";

interface MessageStoreCtx {
  messages: StoredMessage[];
  loaded: boolean;
  addSent: (
    text: string,
    options?: { urgency?: StoredMessage["urgency"]; hasLocation?: boolean },
  ) => StoredMessage;
  addReceived: (text: string) => StoredMessage;
  clearAll: () => Promise<void>;
}

const Ctx = createContext<MessageStoreCtx | null>(null);

export function MessageStoreProvider({ children }: { children: ReactNode }) {
  const store = useMessageStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useMessageStoreCtx(): MessageStoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useMessageStoreCtx must be used inside MessageStoreProvider",
    );
  return ctx;
}
