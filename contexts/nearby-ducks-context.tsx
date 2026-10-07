import { createContext, useContext, type ReactNode } from "react";

import { useNearbyDucks, type NearbyDuck } from "@/hooks/use-nearby-ducks";

interface NearbyDucksCtx {
  nearbyDucks: NearbyDuck[];
  /** Record a duck as seen. Call with (duckId, duckType, lat?, lng?, phoneConnected?) from a SEEN or MTALK frame. */
  addSeen: (
    duckId: string,
    duckType: string,
    lat?: number,
    lng?: number,
    phoneConnected?: boolean,
  ) => void;
}

const Ctx = createContext<NearbyDucksCtx | null>(null);

export function NearbyDucksProvider({ children }: { children: ReactNode }) {
  const store = useNearbyDucks();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNearbyDucksCtx(): NearbyDucksCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useNearbyDucksCtx must be used inside NearbyDucksProvider",
    );
  return ctx;
}
