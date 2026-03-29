/**
 * useLocationTracking
 *
 * When `active` is true, sends a GPS location ping to `targetPeer` via MTALK
 * whenever the device moves more than MIN_DISTANCE_M from the last sent
 * position. No timer — pings are purely movement-triggered.
 *
 * sendPingNow() bypasses the movement threshold for on-demand pings
 * (e.g. in response to a [LOC_REQ] message from the requester).
 *
 * All mutable inputs (gps, serialStatus, sendMTalk, onError) are captured via
 * refs so the effect callback always sees the latest values without needing to
 * be torn down and re-created on every prop change.
 */

import { useCallback, useEffect, useRef } from "react";
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
  sendPingNow: () => Promise<void>;
} {

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

  const lastSentCoordsRef = useRef<GpsCoords | null>(null);

  // ── Movement-triggered pings ──────────────────────────────────────────────
  // Runs whenever gps updates. sendPing() checks the movement threshold
  // internally and no-ops if the user hasn't moved MIN_DISTANCE_M.
  useEffect(() => {
    if (!active) {
      lastSentCoordsRef.current = null;
      return;
    }
    sendPing();
  }, [active, gps, sendPing]);

  // ── On-demand forced ping (called when LOC_REQ is received) ─────────────
  // Bypasses the movement threshold and sends immediately.
  const sendPingNow = useCallback(async () => {
    if (!activeRef.current) return;
    await sendPing(true);
  }, [sendPing]);

  return { sendPingNow };
}
