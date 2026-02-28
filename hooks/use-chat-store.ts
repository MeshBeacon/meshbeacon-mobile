/**
 * useChatStore — persistent storage for MamaDuck-to-MamaDuck (MTALK) chat messages.
 *
 * Messages are stored per-peer and survive app restarts via AsyncStorage.
 * Also persists the last-used target duck ID so the user doesn't have to
 * retype it every time.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const MESSAGES_KEY = "cdk-chat-messages";
const PEER_KEY = "cdk-chat-peer";
const MAX_STORED = 200;

export interface ChatMessage {
  /** Unique ID: timestamp + random suffix */
  id: string;
  /** "sent" = this user sent it; "received" = arrived over LoRa MTALK */
  direction: "sent" | "received";
  text: string;
  /** Whether GPS coordinates were attached to this message */
  hasLocation: boolean;
  /** GPS latitude string — only present when hasLocation is true */
  lat?: string;
  /** GPS longitude string — only present when hasLocation is true */
  lng?: string;
  /** Unix ms timestamp */
  timestamp: number;
}

// ── AsyncStorage helpers ──────────────────────────────────────────────────────

async function loadMessages(): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

async function persistMessages(messages: ChatMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
  } catch {
    // non-fatal
  }
}

async function loadPeer(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(PEER_KEY)) ?? "";
  } catch {
    return "";
  }
}

async function persistPeer(peer: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PEER_KEY, peer);
  } catch {}
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChatStore() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The 8-character DUCK_NAME of the peer this phone is chatting with. */
  const [targetPeer, setTargetPeerState] = useState<string>("");

  // Hydrate from disk
  useEffect(() => {
    Promise.all([loadMessages(), loadPeer()]).then(([msgs, peer]) => {
      setMessages(msgs);
      setTargetPeerState(peer);
      setLoaded(true);
    });
  }, []);

  // Persist messages on change
  useEffect(() => {
    if (loaded) persistMessages(messages);
  }, [messages, loaded]);

  const addMessage = useCallback(
    (entry: {
      direction: "sent" | "received";
      text: string;
      lat?: string;
      lng?: string;
    }) => {
      const hasLocation = !!(entry.lat && entry.lng);
      const msg: ChatMessage = {
        id: makeId(),
        direction: entry.direction,
        text: entry.text,
        hasLocation,
        ...(hasLocation ? { lat: entry.lat, lng: entry.lng } : {}),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg].slice(-MAX_STORED));
      return msg;
    },
    [],
  );

  const addSent = useCallback(
    (text: string, location?: { latitude: number; longitude: number }) =>
      addMessage({
        direction: "sent",
        text,
        ...(location
          ? {
              lat: location.latitude.toFixed(6),
              lng: location.longitude.toFixed(6),
            }
          : {}),
      }),
    [addMessage],
  );

  const addReceived = useCallback(
    (text: string, coords?: { lat: string; lng: string }) =>
      addMessage({ direction: "received", text, ...coords }),
    [addMessage],
  );

  const setTargetPeer = useCallback((peer: string) => {
    setTargetPeerState(peer);
    persistPeer(peer);
  }, []);

  const clearAll = useCallback(async () => {
    setMessages([]);
    await AsyncStorage.removeItem(MESSAGES_KEY);
  }, []);

  return {
    messages,
    loaded,
    targetPeer,
    setTargetPeer,
    addSent,
    addReceived,
    clearAll,
  };
}
