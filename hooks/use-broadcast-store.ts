/**
 * useBroadcastStore — persistent storage for emergency broadcast alerts.
 *
 * Broadcasts survive app restarts and device disconnections via AsyncStorage.
 * Newest alerts are stored first (index 0).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cdk-broadcasts";
const MAX_STORED = 100; // cap to avoid unbounded growth

export interface StoredBroadcast {
  /** Unique ID: timestamp + random suffix */
  id: string;
  text: string;
  /** Unix ms timestamp when the broadcast was received */
  receivedAt: number;
}

// ── Low-level AsyncStorage helpers ────────────────────────────────────────────

async function loadBroadcasts(): Promise<StoredBroadcast[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredBroadcast[];
  } catch {
    return [];
  }
}

async function persistBroadcasts(items: StoredBroadcast[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Non-fatal — in-memory list still works
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBroadcastStore() {
  const [broadcasts, setBroadcasts] = useState<StoredBroadcast[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Hydrate from disk on first mount
  useEffect(() => {
    loadBroadcasts().then((stored) => {
      setBroadcasts(stored);
      setLoaded(true);
    });
  }, []);

  // Persist to disk whenever broadcasts change (but not before the initial
  // load completes, to avoid overwriting the file with an empty array).
  useEffect(() => {
    if (loaded) {
      persistBroadcasts(broadcasts);
    }
  }, [broadcasts, loaded]);

  const addBroadcast = useCallback((text: string, receivedAt: number) => {
    const entry: StoredBroadcast = {
      id: makeId(),
      text,
      receivedAt,
    };
    setBroadcasts((prev) => [entry, ...prev].slice(0, MAX_STORED));
    return entry;
  }, []);

  const clearAll = useCallback(async () => {
    setBroadcasts([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return { broadcasts, loaded, addBroadcast, clearAll };
}
