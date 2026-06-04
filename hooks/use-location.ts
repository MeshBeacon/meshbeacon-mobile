import * as Location from "expo-location";
import { useEffect, useState } from "react";

export type GpsCoords = {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  /** Speed in m/s as reported by the OS. Convert to km/h (×3.6) before display/sending. */
  speed?: number | null;
  heading?: number | null;
};

export type GpsState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "denied" }
  | { status: "ready"; coords: GpsCoords }
  | { status: "error"; message: string };

/**
 * Requests foreground location permission on mount and keeps the latest
 * coordinates updated via a watch subscription.
 *
 * @param enabled  Set to false to skip GPS entirely (no permission request,
 *                 no watcher). Use this to keep GPS off when not needed.
 * @param accuracy Expo Location accuracy level. Defaults to Balanced.
 *                 Pass Accuracy.Low when only a coarse fix is needed (saves
 *                 battery). Pass Accuracy.Balanced or higher when precision
 *                 matters (e.g. active location tracking).
 */
export function useLocation(
  enabled = true,
  accuracy: Location.Accuracy = Location.Accuracy.Balanced,
) {
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
          console.log(
            "[GPS] last known position:",
            last.coords.latitude,
            last.coords.longitude,
          );
          setState({
            status: "ready",
            coords: {
              latitude: last.coords.latitude,
              longitude: last.coords.longitude,
              altitude: last.coords.altitude,
              speed: last.coords.speed,
              heading: last.coords.heading,
            },
          });
        } else {
          console.log("[GPS] no last known position cached");
        }
      } catch {
        // Device has no cached position yet — watcher will deliver one shortly.
      }

      // ── Stage 1: watcher at the requested accuracy level ───────────────────
      // distanceInterval is tuned to the accuracy level so the OS doesn't fire
      // callbacks more often than the precision can meaningfully resolve:
      //   Low      →  100 m  (cell towers, very low power)
      //   Balanced →   10 m  (WiFi + cell, medium power)
      //   High+    →    5 m  (GPS, higher power)
      const distanceInterval =
        accuracy <= Location.Accuracy.Low
          ? 100
          : accuracy === Location.Accuracy.Balanced
            ? 10
            : 5;

      try {
        watcher = await Location.watchPositionAsync(
          { accuracy, distanceInterval },
          (loc) => {
            console.log(
              "[GPS] watcher callback:",
              loc.coords.latitude,
              loc.coords.longitude,
            );
            setState({
              status: "ready",
              coords: {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                altitude: loc.coords.altitude,
                speed: loc.coords.speed,
                heading: loc.coords.heading,
              },
            });
          },
        );
      } catch (watchErr) {
        console.warn("[GPS] watchPositionAsync failed:", watchErr);
        setState({ status: "error", message: String(watchErr) });
        return;
      }
      // Note: no unconditional high-accuracy one-shot here — that would wake
      // the GPS satellite radio on every mount even when only a coarse fix is
      // needed. Callers that need a precise one-time fix should call
      // Location.getCurrentPositionAsync() themselves on demand.
    })();

    return () => {
      watcher?.remove();
    };
  }, [enabled, accuracy]);

  return state;
}
