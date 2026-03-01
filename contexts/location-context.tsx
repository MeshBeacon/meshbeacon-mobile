/**
 * LocationContext
 *
 * Provides a single, app-wide GPS state so that all screens share the same
 * location watcher instead of each starting their own.  This prevents:
 *   – Multiple simultaneous watchPositionAsync subscriptions on iOS
 *   – Modal screens (new-message) starting cold GPS acquisition after the
 *     user opens them, which can leave location = undefined if they send
 *     before the first fix arrives or if the initial fix throws.
 *
 * Battery design
 * ──────────────
 * The default watcher accuracy is Accuracy.Low (cell-tower, ~1 km) which
 * keeps the GPS radio off when precise positioning isn't needed.
 * Any screen that requires finer precision (e.g. active location tracking)
 * should call `useLocationAccuracy()` to request Accuracy.Balanced or higher.
 * The provider picks the highest-requested level across all callers and
 * releases back to Low automatically when no caller needs high accuracy.
 */

import { useLocation, type GpsState } from "@/hooks/use-location";
import * as Location from "expo-location";
import React, {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState
} from "react";

// ── GPS state context (backward-compatible) ───────────────────────────────────
const LocationContext = createContext<GpsState>({ status: "idle" });

// ── Accuracy-request context ──────────────────────────────────────────────────
type AccuracySetter = (id: string, level: Location.Accuracy | null) => void;
const AccuracyContext = createContext<AccuracySetter>(() => {});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  // Map of caller-id → requested accuracy level.
  // null means the caller has released its request.
  const requestsRef = useRef<Map<string, Location.Accuracy>>(new Map());
  const [accuracy, setAccuracy] = useState<Location.Accuracy>(
    Location.Accuracy.Low,
  );

  const requestAccuracy: AccuracySetter = useCallback((id, level) => {
    if (level === null) {
      requestsRef.current.delete(id);
    } else {
      requestsRef.current.set(id, level);
    }
    // Pick the highest level currently requested by any caller.
    const values = [...requestsRef.current.values()];
    const next =
      values.length > 0 ? Math.max(...values) : Location.Accuracy.Low;
    setAccuracy(next as Location.Accuracy);
  }, []);

  const gps = useLocation(true, accuracy);

  return (
    <AccuracyContext.Provider value={requestAccuracy}>
      <LocationContext.Provider value={gps}>
        {children}
      </LocationContext.Provider>
    </AccuracyContext.Provider>
  );
}

/** Drop-in replacement for `useLocation(true)` in any screen. */
export function useLocationCtx(): GpsState {
  return useContext(LocationContext);
}

/**
 * Request a GPS accuracy level for the lifetime of the calling component.
 * Call the returned function with `Accuracy.Balanced` (or higher) when
 * precise positioning is needed, and with `null` to release the request.
 *
 * The provider automatically picks the highest-requested level across all
 * callers, so individual components never conflict with each other.
 *
 * Usage:
 *   const requestAccuracy = useLocationAccuracy();
 *   useEffect(() => {
 *     requestAccuracy(trackingActive ? Location.Accuracy.Balanced : null);
 *     return () => requestAccuracy(null); // release on unmount
 *   }, [trackingActive]);
 */
export function useLocationAccuracy(): (
  level: Location.Accuracy | null,
) => void {
  const requestAccuracy = useContext(AccuracyContext);
  // Stable per-component ID so the provider can track requests independently.
  const id = useRef(`acc-${Math.random().toString(36).slice(2)}`).current;
  return useCallback(
    (level) => requestAccuracy(id, level),
    [requestAccuracy, id],
  );
}
