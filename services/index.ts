/**
 * Unified transport exports.
 *
 * The active transport is managed by SerialContext (contexts/serial-context.tsx),
 * which lets Android users switch between USB and BLE at runtime.
 *
 * Default:
 *   Android → USB Serial
 *   iOS     → BLE (NUS)
 */

import { Platform } from "react-native";
import { bleService } from "./ble";
import { serialService } from "./serial";
import type { ITransport, TransportStatus } from "./transport";

export { bleService } from "./ble";
export { serialService } from "./serial";
export type { ITransport, TransportStatus as SerialStatus, TransportStatus };

export type TransportMode = "usb" | "ble";

export function serviceForMode(mode: TransportMode): ITransport {
  return mode === "usb" ? serialService : bleService;
}

/** Default mode for this platform. */
export const defaultTransportMode: TransportMode =
  Platform.OS === "android" ? "usb" : "ble";
