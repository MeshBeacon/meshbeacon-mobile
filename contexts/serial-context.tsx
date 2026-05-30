import {
    defaultTransportMode,
    serviceForMode,
    type TransportStatus,
} from "@/services";
import { bleService } from "@/services/ble";
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
      }}
    >
      {children}
    </SerialContext.Provider>
  );
}

export function useSerial() {
  return useContext(SerialContext);
}
