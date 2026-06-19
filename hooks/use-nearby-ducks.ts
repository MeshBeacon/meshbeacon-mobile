/**
 * useNearbyDucks — tracks duck IDs seen recently over LoRa.
 *
 * Populated from two sources:
 *   1. CDK:SEEN frames emitted by the firmware whenever it receives a
 *      packet from another duck (any topic).
 *   2. CDK:MTALK frames — the sender's duck ID is always a nearby peer.
 *
 * Entries expire after NEARBY_TTL_MS (5 minutes) of silence. A periodic
 * timer evicts stale entries so the list stays fresh without requiring
 * a re-mount.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a duck stays in the list after its last seen event. */
const NEARBY_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** How often the eviction sweep runs. */
const EVICT_INTERVAL_MS = 30_000;

export interface NearbyDuck {
  duckId: string;
  /** "MAMA" | "LINK" | "PAPA" | "DETC" | "UNKN" */
  duckType: string;
  lastSeen: number;
}

export function useNearbyDucks() {
  const mapRef = useRef<Map<string, NearbyDuck>>(new Map());
  const [nearbyDucks, setNearbyDucks] = useState<NearbyDuck[]>([]);

  const rebuild = useCallback(() => {
    setNearbyDucks(Array.from(mapRef.current.values()));
  }, []);

  const addSeen = useCallback(
    (duckId: string, duckType: string) => {
      if (!duckId || duckId.trim().length === 0) return;
      mapRef.current.set(duckId, { duckId, duckType, lastSeen: Date.now() });
      rebuild();
    },
    [rebuild],
  );

  // Periodically evict entries that have not been seen within the TTL.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, v] of mapRef.current.entries()) {
        if (now - v.lastSeen >= NEARBY_TTL_MS) {
          mapRef.current.delete(k);
          changed = true;
        }
      }
      if (changed) rebuild();
    }, EVICT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [rebuild]);

  return { nearbyDucks, addSeen };
}
