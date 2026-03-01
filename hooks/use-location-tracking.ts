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

export const TRACKING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
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
 * TRACK_REQ_TEXT  A → B: "I would like to send you periodic location pings."
 * TRACK_OK_TEXT   B → A: "I consent. You may start tracking."
 * TRACK_NO_TEXT   B → A: "I do not consent. Do not track me."
 *
 * The firmware forwards these transparently because they are normal TEXT
 * fields; no firmware modification is required.
 */
export const TRACK_REQ_TEXT = "[TRACK_REQ]";
export const TRACK_OK_TEXT = "[TRACK_OK]";
export const TRACK_NO_TEXT = "[TRACK_NO]";

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
  addSent: (
    text: string,
    location?: { latitude: number; longitude: number },
  ) => void;
  onError: (msg: string) => void;
}

export function useLocationTracking({
  active,
  targetPeer,
  gps,
  serialStatus,
  sendMTalk,
  addSent,
  onError,
}: Options): { secondsLeft: number } {
  const [secondsLeft, setSecondsLeft] = useState(0);

  // ── Mutable-value refs so the interval never captures stale closures ──────
  const gpsRef = useRef(gps);
  const serialStatusRef = useRef(serialStatus);
  const targetPeerRef = useRef(targetPeer);
  const sendMTalkRef = useRef(sendMTalk);
  const addSentRef = useRef(addSent);
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
    addSentRef.current = addSent;
  }, [addSent]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ── Core ping function ────────────────────────────────────────────────────
  const sendPing = useCallback(async () => {
    const peer = targetPeerRef.current;
    const currentGps = gpsRef.current;
    const serStatus = serialStatusRef.current;

    if (!peer || peer.length !== 8) {
      onErrorRef.current("Set the duck ID of your chat partner first.");
      return;
    }
    if (currentGps.status !== "ready") {
      onErrorRef.current("No GPS fix yet — retrying at next interval.");
      return;
    }
    if (serStatus === "disconnected" || serStatus === "error") {
      onErrorRef.current("Device not connected — retrying at next interval.");
      return;
    }

    const location = currentGps.coords;

    // ── Movement threshold ───────────────────────────────────────────────
    // Skip the ping if the sender has not moved meaningfully since the last
    // successful transmission — saves both the LoRa radio burst and GPS power.
    if (lastSentCoordsRef.current) {
      const dist = haversineM(lastSentCoordsRef.current, location);
      if (dist < MIN_DISTANCE_M) {
        // Silently skip — not an error, just stationary
        return;
      }
    }

    try {
      await sendMTalkRef.current(peer, LOCATION_PING_TEXT, location);
      addSentRef.current(LOCATION_PING_TEXT, location);
      lastSentCoordsRef.current = location;
    } catch (err) {
      onErrorRef.current((err as Error).message);
    }
  }, []);

  // ── Interval management ───────────────────────────────────────────────────
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const nextPingAtRef = useRef<number>(0);
  const lastSentCoordsRef = useRef<GpsCoords | null>(null);

  useEffect(() => {
    if (!active) {
      // Clear everything when tracking is turned off
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
      pingIntervalRef.current = null;
      countdownIntervalRef.current = null;
      lastSentCoordsRef.current = null;
      setSecondsLeft(0);
      return;
    }

    // Send the first ping immediately on activation
    sendPing();
    const startAt = Date.now();
    nextPingAtRef.current = startAt + TRACKING_INTERVAL_MS;
    setSecondsLeft(TRACKING_INTERVAL_MS / 1000);

    // Schedule recurring pings
    pingIntervalRef.current = setInterval(() => {
      sendPing();
      nextPingAtRef.current = Date.now() + TRACKING_INTERVAL_MS;
      setSecondsLeft(TRACKING_INTERVAL_MS / 1000);
    }, TRACKING_INTERVAL_MS);

    // Tick the countdown every 10 s instead of every 1 s — 10× less work.
    // secondsLeft is recomputed from the scheduled next-ping timestamp so
    // it stays accurate despite the coarser tick rate.
    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.round((nextPingAtRef.current - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
    }, 10_000);

    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
    };
  }, [active, sendPing]);

  return { secondsLeft };
}

/** Format a number of seconds as "1m 30s" or "45s". */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
