/**
 * useEsp32Data — subscribe to incoming frames from the ESP32.
 *
 * Returns live state derived from parsed CDK: frames.
 *
 * The ESP32 firmware should emit frames like:
 *   CDK:BATT,LEVEL:72\n          — battery %
 *   CDK:ID,VALUE:DUCK-01\n       — device identifier
 *   CDK:ACK,ID:3\n               — message acknowledged
 *   CDK:STATUS,RSSI:-45,TEMP:38\n — arbitrary key/value pairs
 *   CDK:ERR,MSG:queue full\n     — error message
 */

import { useBroadcastStoreCtx } from "@/contexts/broadcast-store-context";
import { useChatStoreCtx } from "@/contexts/chat-store-context";
import { useMessageStoreCtx } from "@/contexts/message-store-context";
import { useNearbyDucksCtx } from "@/contexts/nearby-ducks-context";
import { useSerial } from "@/contexts/serial-context";
import type { StoredBroadcast } from "@/hooks/use-broadcast-store";
import { useMessageNotifications } from "@/hooks/use-message-notifications";
import { serviceForMode } from "@/services";
import type {
    AckFrame,
    BattFrame,
    BcastFrame,
    DeviceSosFrame,
    ErrFrame,
    IdFrame,
    IncomingFrame,
    MackFrame,
    MsgFrame,
    MTalkFrame,
    ScanAckFrame,
    SeenFrame,
    SosAckFrame,
    StatusFrame,
} from "@/services/transport";
import { useEffect, useReducer, useRef } from "react";

export interface Esp32Data {
  /** Battery level 0-100, or null if not yet received. */
  battery: number | null;
  /** Unique device ID string set on the ESP32, or null if not yet received. */
  deviceId: string | null;
  /** ID of the last acknowledged message, or null. */
  lastAckId: string | null;
  /** Latest STATUS key/value map from the ESP32. */
  statusFields: Record<string, string>;
  /** Latest error message from the ESP32. */
  lastError: string | null;
  /** The most recently received raw frame. */
  lastFrame: IncomingFrame | null;
  /** Inbound LoRa text messages received from the ESP32, newest first. */
  incomingMessages: MsgFrame[];
  /** Emergency broadcast messages sent by the operator to all devices, newest first.
   * Persisted across disconnects and app restarts. */
  broadcastAlerts: StoredBroadcast[];
  /** SOS alerts triggered by the hardware button on the ESP32, newest first. */
  deviceSosAlerts: DeviceSosFrame[];
  /** Most recent SOS acknowledgment from the operator (via OpenDMS), or null. */
  lastSosAck: SosAckFrame | null;
}

const initial: Omit<Esp32Data, "broadcastAlerts"> = {
  battery: null,
  deviceId: null,
  lastAckId: null,
  statusFields: {},
  lastError: null,
  lastFrame: null,
  incomingMessages: [],
  deviceSosAlerts: [],
  lastSosAck: null,
};

type Action = IncomingFrame | { type: "__RESET__" };

type ReducerState = Omit<Esp32Data, "broadcastAlerts">;

function reduce(state: ReducerState, action: Action): ReducerState {
  if (action.type === "__RESET__") return initial;
  const frame = action as IncomingFrame;
  switch (frame.type) {
    case "BATT":
      return {
        ...state,
        battery: (frame as BattFrame).level,
        lastFrame: frame,
      };
    case "ID":
      return { ...state, deviceId: (frame as IdFrame).value, lastFrame: frame };
    case "ACK":
      return { ...state, lastAckId: (frame as AckFrame).id, lastFrame: frame };
    case "STATUS":
      return {
        ...state,
        statusFields: {
          ...state.statusFields,
          ...(frame as StatusFrame).fields,
        },
        lastFrame: frame,
      };
    case "ERR":
      return {
        ...state,
        lastError: (frame as ErrFrame).message,
        lastFrame: frame,
      };
    case "MSG": {
      const msg = frame as MsgFrame;
      return {
        ...state,
        incomingMessages: [msg, ...state.incomingMessages],
        lastFrame: frame,
      };
    }
    case "BCAST": {
      // Persisted via BroadcastStore — only update lastFrame in the reducer
      return { ...state, lastFrame: frame };
    }
    case "MTALK": {
      // Persisted via ChatStore — only update lastFrame in the reducer
      return { ...state, lastFrame: frame };
    }
    case "MACK": {
      // Delivery receipt — handled in side-effect, not stored in reducer state
      return { ...state, lastFrame: frame };
    }
    case "SOS": {
      const sos = frame as DeviceSosFrame;
      return {
        ...state,
        deviceSosAlerts: [sos, ...state.deviceSosAlerts],
        lastFrame: frame,
      };
    }
    case "SOS_ACK":
      return {
        ...state,
        lastSosAck: frame as SosAckFrame,
        lastFrame: frame,
      };
    default:
      return { ...state, lastFrame: frame };
  }
}

export function useEsp32Data(): Esp32Data {
  const [state, dispatch] = useReducer(reduce, initial);
  const { addReceived } = useMessageStoreCtx();
  const { broadcasts, addBroadcast } = useBroadcastStoreCtx();
  const { addSeen } = useNearbyDucksCtx();
  const {
    addReceived: addChatReceived,
    incrementUnread,
    markDelivered,
    markEncrypted,
  } = useChatStoreCtx();
  const { transportMode, status } = useSerial();
  const {
    notifyNewMessage,
    notifyDeviceSOS,
    notifyEmergencyBroadcast,
    notifyDirectMessage,
    notifySosAck,
  } = useMessageNotifications();

  // Reset all ESP32 data when the transport disconnects
  useEffect(() => {
    if (status === "disconnected") {
      dispatch({ type: "__RESET__" });
    }
  }, [status]);

  // Short-lived cache to deduplicate MTALK frames that arrive multiple times
  // when co-located MamaDucks relay the same LoRa packet to the connected duck.
  // Key: MID (if present) or "<from>:<text>". Value: timestamp of first receipt.
  const mtalkSeen = useRef<Map<string, number>>(new Map());
  const MTALK_DEDUP_MS = 5_000;

  useEffect(() => {
    // Re-subscribe whenever the user switches transport mode (USB ↔ BLE)
    return serviceForMode(transportMode).onFrameReceived((frame) => {
      dispatch(frame);
      if (frame.type === "MSG") {
        const msg = frame as MsgFrame;
        addReceived(msg.text);
        notifyNewMessage(msg.text);
      }
      if (frame.type === "BCAST") {
        const bcast = frame as BcastFrame;
        addBroadcast(bcast.text, bcast.receivedAt);
        notifyEmergencyBroadcast(bcast.text);
      }
      if (frame.type === "SEEN") {
        const seen = frame as SeenFrame;
        if (seen.duckId)
          addSeen(seen.duckId, seen.duckType, seen.lat, seen.lng, seen.phoneConnected);
      }
      if (frame.type === "SCAN_ACK") {
        // Firmware confirmed the scan. If the ping failed (not in PUBLIC
        // network state), surface it as a STATUS field so the map/chat UI
        // can warn the user.
        const ack = frame as ScanAckFrame;
        if (ack.status !== "ping_sent") {
          dispatch({ type: "STATUS", fields: { SCAN: ack.status } } as StatusFrame);
        }
      }
      if (frame.type === "MTALK") {
        const talk = frame as MTalkFrame;
        // Deduplicate relay copies: co-located MamaDucks relay the same LoRa
        // packet, causing the connected duck to receive it more than once.
        const peerId = talk.from ?? "INCOMING";
        // Also register the sender as a known nearby duck (MTALK implies MAMA).
        if (talk.from) addSeen(talk.from, "MAMA");
        const dedupKey = talk.mid
          ? `mid:${talk.mid}`
          : `${peerId}:${talk.text}`;
        const now = Date.now();
        const lastSeen = mtalkSeen.current.get(dedupKey);
        if (!lastSeen || now - lastSeen >= MTALK_DEDUP_MS) {
          mtalkSeen.current.set(dedupKey, now);
          // Evict expired entries to prevent unbounded growth.
          for (const [k, t] of mtalkSeen.current.entries()) {
            if (now - t > MTALK_DEDUP_MS * 2) mtalkSeen.current.delete(k);
          }
          const coords =
            talk.lat && talk.lng ? { lat: talk.lat, lng: talk.lng } : undefined;
          addChatReceived(peerId, talk.text, coords, talk.encrypted);
          incrementUnread(peerId);
          notifyDirectMessage(peerId, talk.text);
        }
      }
      if (frame.type === "MACK") {
        // Delivery receipt — mark the corresponding sent message as delivered
        const mack = frame as MackFrame;
        if (mack.id) markDelivered(mack.id);
      }
      if (frame.type === "ACK") {
        // Local send confirmation for an outgoing MTALK — reports whether it
        // actually went out encrypted or fell back to plaintext.
        const ack = frame as AckFrame;
        if (ack.id === "MTALK" && ack.mid && ack.encrypted !== undefined) {
          markEncrypted(ack.mid, ack.encrypted);
        }
      }
      if (
        frame.type === "SOS" &&
        (frame as DeviceSosFrame).source === "DEVICE"
      ) {
        // Use the ID from the SOS frame if present; fall back to the duck name
        // from the CDK:ID announce (state.deviceId) so the notification still
        // shows a meaningful name even after we removed ID: from the payload.
        const sosDeviceId = (frame as DeviceSosFrame).deviceId || state.deviceId || "ESP32";
        notifyDeviceSOS(sosDeviceId);
      }
      if (frame.type === "SOS_ACK") {
        notifySosAck();
      }
    });
  }, [
    addReceived,
    addBroadcast,
    addSeen,
    addChatReceived,
    incrementUnread,
    markDelivered,
    markEncrypted,
    notifyNewMessage,
    notifyEmergencyBroadcast,
    notifyDeviceSOS,
    notifyDirectMessage,
    notifySosAck,
    transportMode,
  ]);

  return { ...state, broadcastAlerts: broadcasts };
}
