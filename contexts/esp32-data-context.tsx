import { createContext, useContext, type ReactNode } from "react";

import { useEsp32Data, type Esp32Data } from "@/hooks/use-esp32-data";

const Ctx = createContext<Esp32Data | null>(null);

/**
 * Hosts the single `useEsp32Data()` subscription for the whole app.
 *
 * `useEsp32Data` has side effects (storing messages, firing notifications,
 * marking ducks as seen, etc.) that must run exactly once per incoming
 * frame — so it must be mounted once here, not called again from individual
 * screens that merely need to *read* the latest device state (e.g. `deviceId`
 * to recognise the connected device on the map / nearby list).
 */
export function Esp32DataProvider({ children }: { children: ReactNode }) {
  const data = useEsp32Data();
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useEsp32DataCtx(): Esp32Data {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useEsp32DataCtx must be used inside Esp32DataProvider");
  return ctx;
}
