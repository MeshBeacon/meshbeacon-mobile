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

      // Get a fast fix first, then start watching.
      try {
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setState({
          status: "ready",
          coords: {
            latitude: initial.coords.latitude,
            longitude: initial.coords.longitude,
          },
        });
      } catch (err) {
        setState({ status: "error", message: (err as Error).message });
        return;
      }

      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        (location) => {
          setState({
            status: "ready",
            coords: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            },
          });
        },
      );
    })();

    return () => {
      watcher?.remove();
    };
  }, [enabled]);

  return state;
}
