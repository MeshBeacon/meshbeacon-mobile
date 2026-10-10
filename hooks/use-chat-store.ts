/**
 * useChatStore — per-peer thread storage for MamaDuck-to-MamaDuck (MTALK) chat.
 *
 * Messages are stored per sender/recipient duck ID and survive app restarts
 * via AsyncStorage. A `conversations` list (sorted newest-first) is derived
 * from the thread map and exposed for the inbox screen. Unread counts are
 * tracked per peer and cleared when the user opens a thread.
 *
 * Storage schema (key "cdk-chat-v2"):
 *   { threads: Record<peerId, ChatMessage[]>, unread: Record<peerId, number> }
 *
 * Migration: if the legacy flat key "cdk-chat-messages" + "cdk-chat-peer"
 * exist, their content is migrated into the first peer thread automatically.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "cdk-chat-v2";
const LEGACY_MESSAGES_KEY = "cdk-chat-messages";
const LEGACY_PEER_KEY = "cdk-chat-peer";
const MAX_PER_THREAD = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  /** Unique ID: timestamp + random suffix */
  id: string;
  /** "sent" = this user sent it; "received" = arrived via LoRa MTALK */
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
  /** Short random message ID used for delivery receipts (sent messages only). */
  mid?: string;
  /**
   * Delivery status — only set for sent messages that included a MID.
   * "sent" is the initial in-flight state right after the first send.
   * "retrying" means an auto-retry (or manual resend) is currently in
   * flight, waiting on a fresh CDK:MACK receipt for this attempt.
   * "failed" means the bounded auto-retry window (see the chat screen's
   * retry timer) elapsed with no CDK:MACK receipt; the UI offers a manual
   * resend for these.
   */
  deliveryStatus?: "sent" | "retrying" | "delivered" | "failed";
}

/** Summary of a conversation thread — used to render inbox rows. */
export interface Conversation {
  peerId: string;
  lastMessage: ChatMessage | undefined;
  unreadCount: number;
}

interface StorageFormat {
  threads: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
}

// ── AsyncStorage helpers ──────────────────────────────────────────────────────

/** Ensure every message has a valid numeric timestamp (fixes data from old builds). */
function sanitizeMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.map((m) =>
    m.timestamp && !isNaN(m.timestamp) ? m : { ...m, timestamp: Date.now() },
  );
}

async function loadStorage(): Promise<StorageFormat> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StorageFormat;
      const sanitized: StorageFormat = {
        ...parsed,
        threads: Object.fromEntries(
          Object.entries(parsed.threads).map(([k, v]) => [
            k,
            sanitizeMessages(v),
          ]),
        ),
      };
      return sanitized;
    }

    // ── Migrate from legacy flat-list format ──────────────────────────────
    const [legacyRaw, legacyPeer] = await Promise.all([
      AsyncStorage.getItem(LEGACY_MESSAGES_KEY),
      AsyncStorage.getItem(LEGACY_PEER_KEY),
    ]);
    if (legacyRaw && legacyPeer && legacyPeer.length === 8) {
      const msgs = JSON.parse(legacyRaw) as ChatMessage[];
      const threads: Record<string, ChatMessage[]> = { [legacyPeer]: msgs };
      await Promise.allSettled([
        AsyncStorage.removeItem(LEGACY_MESSAGES_KEY),
        AsyncStorage.removeItem(LEGACY_PEER_KEY),
      ]);
      return { threads, unread: {} };
    }
    return { threads: {}, unread: {} };
  } catch {
    return { threads: {}, unread: {} };
  }
}

async function persist(data: StorageFormat): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal — in-memory state still works
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChatStore() {
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  // Hydrate from disk on mount
  useEffect(() => {
    loadStorage().then((data) => {
      setThreads(data.threads);
      setUnread(data.unread);
      setLoaded(true);
    });
  }, []);

  // Persist to disk on every change (skip before hydration to avoid overwrite)
  useEffect(() => {
    if (loaded) persist({ threads, unread });
  }, [threads, unread, loaded]);

  // Mirrors `threads` for `getMessages` below so it can read the *live*
  // state at call time instead of whatever `threads` was at the moment the
  // calling closure was created. This matters a lot for callers like the
  // chat screen's delivery-retry timers: `armRetry(...)` is invoked
  // synchronously right after `addSent(...)`, i.e. *before* React has
  // flushed the state update and re-rendered with the new message. If
  // `getMessages` closed over that pre-update `threads` (as it did when it
  // depended on `[threads]` via useCallback), every `setTimeout` callback
  // inside `armRetry` would capture that same stale, pre-send snapshot
  // forever -- `getMessages(peerId).find((m) => m.mid === mid)` would
  // never find the message it was created to track, silently no-op`ing
  // the entire retry/failed-marking flow for every message, every time.
  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  // ── Derived conversation list ─────────────────────────────────────────────

  /** All known conversations sorted newest-first by last message timestamp. */
  const conversations = useMemo<Conversation[]>(() => {
    return Object.keys(threads)
      .map((peerId) => {
        const msgs = threads[peerId] ?? [];
        return {
          peerId,
          lastMessage: msgs.length > 0 ? msgs[msgs.length - 1] : undefined,
          unreadCount: unread[peerId] ?? 0,
        };
      })
      .sort((a, b) => {
        const ta = a.lastMessage?.timestamp ?? 0;
        const tb = b.lastMessage?.timestamp ?? 0;
        return tb - ta; // newest first
      });
  }, [threads, unread]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addMessage = useCallback(
    (
      peerId: string,
      entry: {
        direction: "sent" | "received";
        text: string;
        lat?: string;
        lng?: string;
        mid?: string;
      },
    ): ChatMessage => {
      const hasLocation = !!(entry.lat && entry.lng);
      const msg: ChatMessage = {
        id: makeId(),
        direction: entry.direction,
        text: entry.text,
        hasLocation,
        ...(hasLocation ? { lat: entry.lat, lng: entry.lng } : {}),
        ...(entry.mid
          ? { mid: entry.mid, deliveryStatus: "sent" as const }
          : {}),
        timestamp: Date.now(),
      };
      setThreads((prev) => {
        const existing = prev[peerId] ?? [];
        return {
          ...prev,
          [peerId]: [...existing, msg].slice(-MAX_PER_THREAD),
        };
      });
      return msg;
    },
    [],
  );

  /** Add a message sent by this user to the given peer. */
  const addSent = useCallback(
    (
      peerId: string,
      text: string,
      location?: { latitude: number; longitude: number },
      mid?: string,
    ) =>
      addMessage(peerId, {
        direction: "sent",
        text,
        mid,
        ...(location
          ? {
              lat: location.latitude.toFixed(6),
              lng: location.longitude.toFixed(6),
            }
          : {}),
      }),
    [addMessage],
  );

  /** Add a message received from the given peer. */
  const addReceived = useCallback(
    (peerId: string, text: string, coords?: { lat: string; lng: string }) =>
      addMessage(peerId, { direction: "received", text, ...coords }),
    [addMessage],
  );

  /**
   * Get the full message list for a specific peer thread. Reads from
   * `threadsRef` (not the `threads` state captured in this closure) so
   * that callers which stash this function away for later -- e.g. the
   * chat screen's retry timers -- always see live data, not a snapshot
   * frozen at the time the function reference was handed out.
   */
  const getMessages = useCallback(
    (peerId: string): ChatMessage[] => threads[peerId] ?? [],
    [threads],
  );

  /**
   * Same as `getMessages`, but with a stable identity across renders and
   * reading from `threadsRef` instead of closing over `threads`. Use this
   * (not `getMessages`) from inside callbacks that get created once and
   * invoked much later -- e.g. a `setTimeout` scheduled by a delivery-retry
   * timer -- since `getMessages`'s identity (and the `threads` it closes
   * over) changes on every thread update, which would otherwise permanently
   * freeze such a callback's view of the data as of the moment it was
   * created, before the very message it's tracking may have even been
   * added yet.
   */
  const getMessagesLive = useCallback(
    (peerId: string): ChatMessage[] => threadsRef.current[peerId] ?? [],
    [],
  );

  /** Clear the unread badge for a peer (call when the user opens the thread). */
  const markRead = useCallback((peerId: string) => {
    setUnread((prev) => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  /** Increment the unread counter for a peer (call on each incoming MTALK). */
  const incrementUnread = useCallback((peerId: string) => {
    setUnread((prev) => ({ ...prev, [peerId]: (prev[peerId] ?? 0) + 1 }));
  }, []);

  /**
   * Mark the sent message with the given MID as delivered.
   * Called when a CDK:MACK frame arrives from the peer's duck.
   */
  const markDelivered = useCallback((mid: string) => {
    setThreads((prev) => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [peerId, msgs] of Object.entries(prev)) {
        next[peerId] = msgs.map((m) =>
          m.mid === mid ? { ...m, deliveryStatus: "delivered" as const } : m,
        );
      }
      return next;
    });
  }, []);

  /**
   * Mark the sent message with the given MID as failed — called by the
   * chat screen's retry timer once the bounded auto-retry window elapses
   * with no CDK:MACK delivery receipt. Surfaces a manual resend in the UI.
   */
  const markFailed = useCallback((mid: string) => {
    setThreads((prev) => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [peerId, msgs] of Object.entries(prev)) {
        next[peerId] = msgs.map((m) =>
          m.mid === mid ? { ...m, deliveryStatus: "failed" as const } : m,
        );
      }
      return next;
    });
  }, []);

  /**
   * Mark a message as actively retrying when an automatic or manual resend
   * is issued, so the UI can show a distinct in-flight indicator instead of
   * looking identical to the original "sent" state (or stuck on "failed")
   * while the new attempt is pending.
   */
  const markRetrying = useCallback((mid: string) => {
    setThreads((prev) => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [peerId, msgs] of Object.entries(prev)) {
        next[peerId] = msgs.map((m) =>
          m.mid === mid ? { ...m, deliveryStatus: "retrying" as const } : m,
        );
      }
      return next;
    });
  }, []);

  /** Delete all messages for one peer. */
  const clearThread = useCallback((peerId: string) => {
    setThreads((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setUnread((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  /** Delete every thread and wipe from disk. */
  const clearAll = useCallback(async () => {
    setThreads({});
    setUnread({});
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  return {
    conversations,
    loaded,
    addSent,
    addReceived,
    getMessages,
    getMessagesLive,
    markRead,
    incrementUnread,
    markDelivered,
    markFailed,
    markRetrying,
    clearThread,
    clearAll,
  };
}
