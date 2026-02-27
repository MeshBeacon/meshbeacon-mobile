/**
 * LocationContext
 *
 * Provides a single, app-wide GPS state so that all screens share the same
 * location watcher instead of each starting their own.  This prevents:
 *   – Multiple simultaneous watchPositionAsync subscriptions on iOS
 *   – Modal screens (new-message) starting cold GPS acquisition after the
 *     user opens them, which can leave location = undefined if they send
 *     before the first fix arrives or if the initial fix throws.
 */

import React, { createContext, useContext } from "react";
import { type GpsState } from "@/hooks/use-location";
import { useLocation } from "@/hooks/use-location";

const LocationContext = createContext<GpsState>({ status: "idle" });

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const gps = useLocation(true);
  return (
    <LocationContext.Provider value={gps}>{children}</LocationContext.Provider>
  );
}

/** Drop-in replacement for `useLocation(true)` in any screen. */
export function useLocationCtx(): GpsState {
  return useContext(LocationContext);
}
