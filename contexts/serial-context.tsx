import {
    defaultTransportMode,
    serviceForMode,
    type TransportStatus,
} from "@/services";
import { bleService } from "@/services/ble";
import { useLocationCtx } from "@/contexts/location-context";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

export type TransportMode = "usb" | "ble";

interface SerialContextValue {
  status: TransportStatus;
  transportMode: TransportMode;
  setTransportMode: (mode: TransportMode) => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  connectToBleDevice: (deviceId: string) => Promise<boolean>;
  sendSOS: (location?: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
  }) => Promise<void>;
  sendMessage: (opts: {
    text: string;
    urgency: "low" | "medium" | "critical";
    location?: { latitude: number; longitude: number };
  }) => Promise<void>;
  sendMTalk: (
    targetId: string,
    text: string,
    location?: { latitude: number; longitude: number },
    mid?: string,
  ) => Promise<void>;
  sendGps: (location?: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
  }) => Promise<void>;
}

const SerialContext = createContext<SerialContextValue>({
  status: "disconnected",
  transportMode: defaultTransportMode,
  setTransportMode: async () => {},
  connect: async () => false,
  disconnect: async () => {},
  connectToBleDevice: async () => false,
  sendSOS: async () => {},
  sendMessage: async () => {},
  sendMTalk: async () => {},
  sendGps: async () => {},
});

export function SerialProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<TransportMode>(defaultTransportMode);
  const [status, setStatus] = useState<TransportStatus>(
    serviceForMode(defaultTransportMode).status,
  );
  const unsubRef = useRef<(() => void) | null>(null);

  const subscribeToMode = useCallback((m: TransportMode) => {
    unsubRef.current?.();
    const svc = serviceForMode(m);
    setStatus(svc.status);
    unsubRef.current = svc.onStatusChange((s) => setStatus(s));
  }, []);

  useEffect(() => {
    subscribeToMode(mode);
    return () => unsubRef.current?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTransportMode = useCallback(
    async (newMode: TransportMode) => {
      const current = serviceForMode(mode);
      if (current.status !== "disconnected") await current.disconnect();
      setMode(newMode);
      subscribeToMode(newMode);
    },
    [mode, subscribeToMode],
  );

  const connect = useCallback(() => serviceForMode(mode).connect(), [mode]);
  const disconnect = useCallback(
    () => serviceForMode(mode).disconnect(),
    [mode],
  );
  const connectToBleDevice = useCallback(
    (deviceId: string) => bleService.connect(deviceId),
    [],
  );
  const sendSOS = useCallback(
    (loc?: { latitude: number; longitude: number }) =>
      serviceForMode(mode).sendSOS(loc),
    [mode],
  );
  const sendMessage = useCallback(
    (opts: {
      text: string;
      urgency: "low" | "medium" | "critical";
      location?: { latitude: number; longitude: number };
    }) => serviceForMode(mode).sendMessage(opts),
    [mode],
  );
  const sendMTalk = useCallback(
    (
      targetId: string,
      text: string,
      location?: { latitude: number; longitude: number },
      mid?: string,
    ) => serviceForMode(mode).sendMTalk(targetId, text, location, mid),
    [mode],
  );
  const sendGps = useCallback(
    (loc?: { latitude: number; longitude: number }) =>
      serviceForMode(mode).sendGps(loc),
    [mode],
  );

  // Auto-respond to GPSREQ frames from the ESP32 with the phone's GPS coords.
  const gps = useLocationCtx();
  const gpsRef = useRef(gps);
  useEffect(() => { gpsRef.current = gps; }, [gps]);
  useEffect(() => {
    return serviceForMode(mode).onFrameReceived((frame) => {
      if (frame.type !== "GPSREQ") return;

      const svc = serviceForMode(mode);

      // Poll gpsRef every 200 ms until either GPS is ready or the deadline
      // (5 s) passes, then fall back to sending "none" so the firmware can
      // still record a FIX:0 entry rather than waiting indefinitely.
      const deadline = Date.now() + 5000;

      const trySend = () => {
        const loc = gpsRef.current;
        if (loc.status === "ready") {
          svc
            .sendGps({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              altitude: loc.coords.altitude,
              speed: loc.coords.speed,
              heading: loc.coords.heading,
            })
            .catch((e) => console.warn("[GPS] sendGps failed:", e));
        } else if (loc.status === "denied" || loc.status === "error" || Date.now() >= deadline) {
          // Permission denied, a GPS error occurred, or timeout — send none so
          // the firmware can at least record that the phone has no fix.
          svc.sendGps().catch((e) => console.warn("[GPS] sendGps (no fix) failed:", e));
        } else {
          // Still acquiring — try again shortly.
          setTimeout(trySend, 200);
        }
      };

      trySend();
    });
  }, [mode]);

  return (
    <SerialContext.Provider
      value={{
        status,
        transportMode: mode,
        setTransportMode,
        connect,
        disconnect,
        connectToBleDevice,
        sendSOS,
        sendMessage,
        sendMTalk,
        sendGps,
      }}
    >
      {children}
    </SerialContext.Provider>
  );
}

export function useSerial() {
  return useContext(SerialContext);
}
