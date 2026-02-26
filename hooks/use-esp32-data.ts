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

import { useMessageStoreCtx } from "@/contexts/message-store-context";
import { useSerial } from "@/contexts/serial-context";
import { useMessageNotifications } from "@/hooks/use-message-notifications";
import { serviceForMode } from "@/services";
import type {
  AckFrame,
  BattFrame,
  DeviceSosFrame,
  ErrFrame,
  IdFrame,
  IncomingFrame,
  MsgFrame,
  StatusFrame,
} from "@/services/transport";
import { useEffect, useReducer } from "react";

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
  /** SOS alerts triggered by the hardware button on the ESP32, newest first. */
  deviceSosAlerts: DeviceSosFrame[];
}

const initial: Esp32Data = {
  battery: null,
  deviceId: null,
  lastAckId: null,
  statusFields: {},
  lastError: null,
  lastFrame: null,
  incomingMessages: [],
  deviceSosAlerts: [],
};

type Action = IncomingFrame | { type: "__RESET__" };

function reduce(state: Esp32Data, action: Action): Esp32Data {
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
    case "SOS": {
      const sos = frame as DeviceSosFrame;
      return {
        ...state,
        deviceSosAlerts: [sos, ...state.deviceSosAlerts],
        lastFrame: frame,
      };
    }
    default:
      return { ...state, lastFrame: frame };
  }
}

export function useEsp32Data(): Esp32Data {
  const [state, dispatch] = useReducer(reduce, initial);
  const { addReceived } = useMessageStoreCtx();
  const { transportMode, status } = useSerial();
  const { notifyNewMessage, notifyDeviceSOS } = useMessageNotifications();

  // Reset all ESP32 data when the transport disconnects
  useEffect(() => {
    if (status === "disconnected") {
      dispatch({ type: "__RESET__" });
    }
  }, [status]);

  useEffect(() => {
    // Re-subscribe whenever the user switches transport mode (USB ↔ BLE)
    return serviceForMode(transportMode).onFrameReceived((frame) => {
      dispatch(frame);
      if (frame.type === "MSG") {
        const msg = frame as MsgFrame;
        addReceived(msg.text);
        notifyNewMessage(msg.text);
      }
      if (
        frame.type === "SOS" &&
        (frame as DeviceSosFrame).source === "DEVICE"
      ) {
        notifyDeviceSOS((frame as DeviceSosFrame).deviceId);
      }
    });
  }, [addReceived, transportMode]);

  return state;
}
