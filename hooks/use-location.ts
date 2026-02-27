import * as Location from "expo-location";
import { useEffect, useState } from "react";

export type GpsCoords = { latitude: number; longitude: number };

export type GpsState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "denied" }
  | { status: "ready"; coords: GpsCoords }
  | { status: "error"; message: string };

/**
 * Requests foreground location permission on mount and keeps the latest
 * coordinates updated via a watch subscription.
 */
export function useLocation(enabled = true) {
  const [state, setState] = useState<GpsState>({ status: "idle" });

  useEffect(() => {
    if (!enabled) return;

    let watcher: Location.LocationSubscription | null = null;

    (async () => {
      setState({ status: "requesting" });

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setState({ status: "denied" });
        return;
      }

      // Start the watcher first so we never miss a fix, then attempt a fast
      // one-shot fix to populate coords immediately.  On iOS, the initial
      // getCurrentPositionAsync can throw a transient error (cold GPS, weak
      // signal) — previously that caused an early return and left the watcher
      // never started, so coords stayed undefined for the whole session.
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        (loc) => {
          setState({
            status: "ready",
            coords: {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            },
          });
        },
      );

      // Best-effort fast fix — failure is non-fatal because the watcher above
      // will deliver the first position on its own shortly after.
      try {
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        // Only apply if the watcher hasn't already delivered a fresher fix.
        setState((prev) => {
          if (prev.status === "ready") return prev; // watcher already won
          return {
            status: "ready",
            coords: {
              latitude: initial.coords.latitude,
              longitude: initial.coords.longitude,
            },
          };
        });
      } catch {
        // Transient failure — watcher will still deliver coords; stay in
        // "requesting" state until it does rather than showing an error.
      }
    })();

    return () => {
      watcher?.remove();
    };
  }, [enabled]);

  return state;
}
