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
import type { GpsState } from "./use-location";

export const TRACKING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
/** Sentinel text used for location-only pings that have no human message. */
export const LOCATION_PING_TEXT = "📍";

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
    try {
      await sendMTalkRef.current(peer, LOCATION_PING_TEXT, location);
      addSentRef.current(LOCATION_PING_TEXT, location);
    } catch (err) {
      onErrorRef.current((err as Error).message);
    }
  }, []);

  // ── Interval management ───────────────────────────────────────────────────
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  useEffect(() => {
    if (!active) {
      // Clear everything when tracking is turned off
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
      pingIntervalRef.current = null;
      countdownIntervalRef.current = null;
      setSecondsLeft(0);
      return;
    }

    // Send the first ping immediately on activation
    sendPing();
    setSecondsLeft(TRACKING_INTERVAL_MS / 1000);

    // Schedule recurring pings
    pingIntervalRef.current = setInterval(() => {
      sendPing();
      setSecondsLeft(TRACKING_INTERVAL_MS / 1000);
    }, TRACKING_INTERVAL_MS);

    // Tick the countdown every second
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

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
