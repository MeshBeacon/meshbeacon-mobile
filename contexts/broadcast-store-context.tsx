import { createContext, useContext, type ReactNode } from "react";

import {
    useBroadcastStore,
    type StoredBroadcast,
} from "@/hooks/use-broadcast-store";

interface BroadcastStoreCtx {
  broadcasts: StoredBroadcast[];
  loaded: boolean;
  addBroadcast: (text: string, receivedAt: number) => StoredBroadcast;
  clearAll: () => Promise<void>;
}

const Ctx = createContext<BroadcastStoreCtx | null>(null);

export function BroadcastStoreProvider({ children }: { children: ReactNode }) {
  const store = useBroadcastStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useBroadcastStoreCtx(): BroadcastStoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useBroadcastStoreCtx must be used inside BroadcastStoreProvider",
    );
  return ctx;
}
