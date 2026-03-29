/**
 * useLocationTracking
 *
 * When `active` is true, immediately sends a GPS location ping to `targetPeer`
 * via MTALK and then repeats every INTERVAL_MS (2 minutes).  A 1-second
 * countdown ticker keeps the caller informed of when the next ping fires.
 *
 * All mutable inputs (gps, serialStatus, sendMTalk, addSent, onError) are
 * captured via refs so the interval callback always sees the latest values
 * without needing to be torn down and re-created on every prop change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GpsCoords, GpsState } from "./use-location";

/** Haversine distance in metres between two GPS coordinates. */
function haversineM(a: GpsCoords, b: GpsCoords): number {
  const R = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const TRACKING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes base
/**
 * Maximum ping interval under exponential backoff (10 minutes).
 * Reached after ~2-3 consecutive stationary skips.
 */
export const MAX_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Minimum distance (metres) the sender must have moved since the last
 * successful ping before a new one is transmitted.  Keeps the radio and GPS
 * hardware idle when the user is stationary.
 */
export const MIN_DISTANCE_M = 30; // ~30 m — 1 house-width
/**
 * Sentinel text for location-only pings.
 * Kept as plain ASCII so it survives hex encoding, LoRa payload bytes,
 * and any firmware string handling without corruption.
 */
export const LOCATION_PING_TEXT = "[LOC]";

/**
 * Tracking consent sentinels — sent as regular MTALK TEXT payloads.
 *
 * TRACK_REQ_TEXT  A → B: "I want to track your location. Do you consent?"
 * TRACK_OK_TEXT   B → A: "I consent." (B then starts sending periodic location pings to A)
 * TRACK_NO_TEXT   B → A: "I do not consent. Do not track me."
 *
 * The firmware forwards these transparently because they are normal TEXT
 * fields; no firmware modification is required.
 */
export const TRACK_REQ_TEXT = "[TRACK_REQ]";
export const TRACK_OK_TEXT = "[TRACK_OK]";
export const TRACK_NO_TEXT = "[TRACK_NO]";
/**
 * LOC_REQ_TEXT  A → B: "Send me your location right now, skip the timer."
 * B receives it and fires an immediate forced ping, then resets the countdown.
 */
export const LOC_REQ_TEXT = "[LOC_REQ]";

interface Options {
  active: boolean;
  targetPeer: string;
  gps: GpsState;
  serialStatus: string;
  sendMTalk: (
    target: string,
    text: string,
    location?: { latitude: number; longitude: number },
  ) => Promise<void>;
  onError: (msg: string) => void;
}

export function useLocationTracking({
  active,
  targetPeer,
  gps,
  serialStatus,
  sendMTalk,
  onError,
}: Options): {
  secondsLeft: number;
  currentIntervalMs: number;
  sendPingNow: () => Promise<void>;
} {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [currentIntervalMs, setCurrentIntervalMs] =
    useState(TRACKING_INTERVAL_MS);

  // ── Mutable-value refs so the interval never captures stale closures ──────
  const gpsRef = useRef(gps);
  const serialStatusRef = useRef(serialStatus);
  const targetPeerRef = useRef(targetPeer);
  const sendMTalkRef = useRef(sendMTalk);
  const onErrorRef = useRef(onError);
  const activeRef = useRef(active);

  useEffect(() => {
    gpsRef.current = gps;
  }, [gps]);
  useEffect(() => {
    serialStatusRef.current = serialStatus;
  }, [serialStatus]);
  useEffect(() => {
    targetPeerRef.current = targetPeer;
  }, [targetPeer]);
  useEffect(() => {
    sendMTalkRef.current = sendMTalk;
  }, [sendMTalk]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── Core ping function ────────────────────────────────────────────────────
  // Returns true when a ping was actually transmitted, false when skipped
  // (no GPS fix, disconnected, or below movement threshold).
  // Pass force=true to bypass the movement-threshold check (used for on-demand pings).
  const sendPing = useCallback(async (force = false): Promise<boolean> => {
    const peer = targetPeerRef.current;
    const currentGps = gpsRef.current;
    const serStatus = serialStatusRef.current;

    if (!peer || peer.length !== 8) {
      onErrorRef.current("Set the duck ID of your chat partner first.");
      return false;
    }
    if (currentGps.status !== "ready") {
      onErrorRef.current("No GPS fix yet — retrying at next interval.");
      return false;
    }
    if (serStatus === "disconnected" || serStatus === "error") {
      onErrorRef.current("Device not connected — retrying at next interval.");
      return false;
    }

    const location = currentGps.coords;

    // ── Movement threshold ───────────────────────────────────────────────
    // Skip the ping if the sender has not moved meaningfully since the last
    // successful transmission — saves both the LoRa radio burst and GPS power.
    // force=true bypasses this check for on-demand (LOC_REQ) pings.
    if (!force && lastSentCoordsRef.current) {
      const dist = haversineM(lastSentCoordsRef.current, location);
      if (dist < MIN_DISTANCE_M) {
        // Silently skip — not an error, just stationary
        return false;
      }
    }

    try {
      await sendMTalkRef.current(peer, LOCATION_PING_TEXT, location);
      lastSentCoordsRef.current = location;
      return true;
    } catch (err) {
      onErrorRef.current((err as Error).message);
      return false;
    }
  }, []);

  // ── Interval management with exponential backoff ──────────────────────────
  // When stationary (sendPing returns false), the next interval is doubled up
  // to MAX_INTERVAL_MS. On movement (sendPing returns true), it resets to the
  // base TRACKING_INTERVAL_MS. This dramatically cuts LoRa radio activity and
  // GPS queries when the user hasn't moved.
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const nextPingAtRef = useRef<number>(0);
  const lastSentCoordsRef = useRef<GpsCoords | null>(null);
  const currentIntervalMsRef = useRef<number>(TRACKING_INTERVAL_MS);
  // Holds the schedulePing function so sendPingNow can reschedule from outside the effect
  const scheduleRef = useRef<((delayMs: number) => void) | null>(null);

  useEffect(() => {
    if (!active) {
      // Clear everything when tracking is turned off
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
      pingTimeoutRef.current = null;
      countdownIntervalRef.current = null;
      lastSentCoordsRef.current = null;
      currentIntervalMsRef.current = TRACKING_INTERVAL_MS;
      setSecondsLeft(0);
      setCurrentIntervalMs(TRACKING_INTERVAL_MS);
      return;
    }

    // Schedule the next ping after `delayMs`, then chain via setTimeout so the
    // interval can be adjusted dynamically based on movement.
    const schedulePing = (delayMs: number) => {
      scheduleRef.current = schedulePing; // keep ref current
      nextPingAtRef.current = Date.now() + delayMs;
      setSecondsLeft(Math.round(delayMs / 1000));

      pingTimeoutRef.current = setTimeout(async () => {
        const moved = await sendPing();

        if (!activeRef.current) return; // tracking was stopped mid-flight

        if (moved) {
          // User moved — reset backoff to base interval
          currentIntervalMsRef.current = TRACKING_INTERVAL_MS;
        } else {
          // Stationary — double the interval (capped at MAX_INTERVAL_MS)
          currentIntervalMsRef.current = Math.min(
            currentIntervalMsRef.current * 2,
            MAX_INTERVAL_MS,
          );
        }

        setCurrentIntervalMs(currentIntervalMsRef.current);
        schedulePing(currentIntervalMsRef.current);
      }, delayMs);
    };

    scheduleRef.current = schedulePing;

    // Send the first ping immediately on activation, then start the chain
    const boot = async () => {
      const moved = await sendPing();
      if (!activeRef.current) return;
      // If the first ping was skipped (no fix yet), start at base interval
      if (!moved) currentIntervalMsRef.current = TRACKING_INTERVAL_MS;
      setCurrentIntervalMs(currentIntervalMsRef.current);
      schedulePing(currentIntervalMsRef.current);
    };
    boot();

    // Tick the countdown every 10 s — 10× less JS work than 1-second ticks.
    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.round((nextPingAtRef.current - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    }, 10_000);

    return () => {
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
    };
  }, [active, sendPing]);

  // ── On-demand forced ping (called when LOC_REQ is received) ─────────────
  // Bypasses the movement threshold, cancels the pending timer, sends
  // immediately, then resets backoff and reschedules from the base interval.
  const sendPingNow = useCallback(async () => {
    if (!activeRef.current) return;
    if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
    await sendPing(true); // force — ignore movement threshold
    if (!activeRef.current) return;
    currentIntervalMsRef.current = TRACKING_INTERVAL_MS;
    setCurrentIntervalMs(TRACKING_INTERVAL_MS);
    scheduleRef.current?.(TRACKING_INTERVAL_MS);
  }, [sendPing]);

  return { secondsLeft, currentIntervalMs, sendPingNow };
}

/** Format a number of seconds as "1m 30s" or "45s". */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
