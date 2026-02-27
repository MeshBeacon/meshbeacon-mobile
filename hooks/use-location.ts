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

      // ── Stage 0: use the last cached position for instant readiness ─────────
      // On iOS, CoreLocation may already have a cached fix from a prior session.
      // getLastKnownPositionAsync() returns it synchronously (no radio wake-up),
      // so we can transition to "ready" before the first watcher callback fires.
      // This is the primary reason GPS was missing when the user sent quickly.
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last) {
          console.log("[GPS] last known position:", last.coords.latitude, last.coords.longitude);
          setState({
            status: "ready",
            coords: {
              latitude: last.coords.latitude,
              longitude: last.coords.longitude,
            },
          });
        } else {
          console.log("[GPS] no last known position cached");
        }
      } catch {
        // Device has no cached position yet — watcher will deliver one shortly.
      }

      // ── Stage 1: fast coarse fix via WiFi/cell (Balanced) ─────────────────
      // On iOS, Accuracy.High waits for satellite GPS which can take 30–60 s
      // indoors. Accuracy.Balanced uses WiFi + cell towers and typically
      // delivers a fix within 1–2 s, which is good enough to unblock sends.
      // We also omit distanceInterval so iOS delivers every available update
      // without a movement-threshold gate.
      try {
        watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced },
          (loc) => {
            console.log("[GPS] watcher callback:", loc.coords.latitude, loc.coords.longitude);
            setState({
              status: "ready",
              coords: {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              },
            });
          },
        );
      } catch (watchErr) {
        console.warn("[GPS] watchPositionAsync failed:", watchErr);
        setState({ status: "error", message: String(watchErr) });
        return;
      }

      // ── Stage 2: one-shot high-accuracy upgrade ────────────────────────────
      // Runs in the background after the watcher is live. Failure is silently
      // ignored — the Balanced watcher fix is already usable.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then((fix) => {
          setState((prev) => {
            if (prev.status !== "ready") return prev;
            return {
              status: "ready",
              coords: {
                latitude: fix.coords.latitude,
                longitude: fix.coords.longitude,
              },
            };
          });
        })
        .catch(() => {
          /* high-accuracy shot failed — keep watcher's coarse fix */
        });
    })();

    return () => {
      watcher?.remove();
    };
  }, [enabled]);

  return state;
}
