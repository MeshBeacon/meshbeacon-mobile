/**
 * useMessageStore — persistent storage for sent and received messages.
 *
 * Messages survive app restarts via AsyncStorage.
 * Both outbound (sent by user) and inbound (LoRa relayed) messages
 * are stored in a single chronological list, newest first.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cdk-messages";
const MAX_STORED = 200; // cap to avoid unbounded growth

export type MessageDirection = "sent" | "received";

export interface StoredMessage {
  /** Unique ID: timestamp + random suffix */
  id: string;
  direction: MessageDirection;
  text: string;
  /** Only present on sent messages */
  urgency?: "low" | "medium" | "critical";
  /** Whether GPS coordinates were attached (sent) or not applicable */
  hasLocation: boolean;
  /** Unix ms timestamp — when sent or when received by the app */
  timestamp: number;
}

// ── Low-level AsyncStorage helpers ───────────────────────────────────────────

async function loadMessages(): Promise<StoredMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredMessage[];
  } catch {
    return [];
  }
}

async function persistMessages(messages: StoredMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Non-fatal — in-memory list still works
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMessageStore() {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Hydrate from disk on first mount
  useEffect(() => {
    loadMessages().then((stored) => {
      setMessages(stored);
      setLoaded(true);
    });
  }, []);

  // Persist to disk whenever messages change (but not before the initial load
  // completes, to avoid overwriting the file with an empty array on mount).
  useEffect(() => {
    if (loaded) {
      persistMessages(messages);
    }
  }, [messages, loaded]);

  const addMessage = useCallback(
    (entry: Omit<StoredMessage, "id" | "timestamp">) => {
      const newMsg: StoredMessage = {
        ...entry,
        id: makeId(),
        timestamp: Date.now(),
      };
      // State updaters must be pure — persistence is handled by the useEffect above.
      setMessages((prev) => [newMsg, ...prev].slice(0, MAX_STORED));
      return newMsg;
    },
    [],
  );

  const addSent = useCallback(
    (
      text: string,
      options?: { urgency?: StoredMessage["urgency"]; hasLocation?: boolean },
    ) =>
      addMessage({
        direction: "sent",
        text,
        urgency: options?.urgency,
        hasLocation: options?.hasLocation ?? false,
      }),
    [addMessage],
  );

  const addReceived = useCallback(
    (text: string) =>
      addMessage({ direction: "received", text, hasLocation: false }),
    [addMessage],
  );

  const clearAll = useCallback(async () => {
    setMessages([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return { messages, loaded, addSent, addReceived, clearAll };
}
