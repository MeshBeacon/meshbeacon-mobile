/**
 * Shared transport interface.
 * USB-serial (Android) and BLE both implement this so the rest of the app
 * doesn't need to care which is in use.
 */

// ── Outbound (app → ESP32) ────────────────────────────────────────────────────

/** Lifecycle states shared across both transports. */
export type TransportStatus =
  | "disconnected"
  | "scanning" // BLE: actively scanning for the device
  | "connecting" // pairing / opening port
  | "connected"
  | "error";

export type StatusCallback = (status: TransportStatus, detail?: string) => void;

// ── Inbound (ESP32 → app) ─────────────────────────────────────────────────────

/**
 * Typed incoming frames.  The ESP32 sends newline-terminated ASCII strings
 * using the same CDK: prefix:
 *
 *   CDK:BATT,LEVEL:72\n           → BattFrame   — battery %
 *   CDK:ID,VALUE:DUCK-01\n        → IdFrame     — device identifier
 *   CDK:ACK,ID:3\n                → AckFrame    — message acknowledged
 *   CDK:STATUS,RSSI:-45,TEMP:38\n → StatusFrame — arbitrary key/value
 *   CDK:ERR,MSG:queue full\n      → ErrFrame    — error string
 *   CDK:MSG,TEXT:help\n           → MsgFrame    — inbound LoRa text message
 *
 *   CDK:BCAST,TEXT:evacuate now\n    → BcastFrame  — emergency broadcast to all
 *
 * All frames must fit within MAX_FRAME_BYTES (256) including the trailing \n.
 * Any unrecognised type lands in UnknownFrame so nothing is silently dropped.
 */

/** Maximum frame size in bytes (including the trailing newline). */
export const MAX_FRAME_BYTES = 256;
export type BattFrame = { type: "BATT"; level: number };
export type IdFrame = { type: "ID"; value: string };
export type AckFrame = { type: "ACK"; id: string };
export type StatusFrame = { type: "STATUS"; fields: Record<string, string> };
export type ErrFrame = { type: "ERR"; message: string };
export type MsgFrame = {
  type: "MSG";
  text: string;
  receivedAt: number;
};
/** Emergency broadcast from the operator to ALL devices (topic 24). */
export type BcastFrame = {
  type: "BCAST";
  text: string;
  receivedAt: number;
};
/** SOS triggered by the hardware button on the ESP32 device itself. */
export type DeviceSosFrame = {
  type: "SOS";
  source: "DEVICE" | "APP";
  deviceId: string;
  lat: string;
  lng: string;
  receivedAt: number;
};
export type UnknownFrame = { type: string; raw: string };

export type IncomingFrame =
  | BattFrame
  | IdFrame
  | AckFrame
  | StatusFrame
  | ErrFrame
  | MsgFrame
  | BcastFrame
  | DeviceSosFrame
  | UnknownFrame;

export type FrameCallback = (frame: IncomingFrame) => void;

// ── Parser ────────────────────────────────────────────────────────────────────

const FRAME_PREFIX = "CDK:";

/** Parse a single "CDK:<TYPE>,k1:v1,k2:v2" line into a typed frame. */
export function parseIncomingLine(line: string): IncomingFrame | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(FRAME_PREFIX)) return null;

  const body = trimmed.slice(FRAME_PREFIX.length); // "TYPE,k:v,..."
  const commaIdx = body.indexOf(",");
  const type = commaIdx === -1 ? body : body.slice(0, commaIdx);
  const rest = commaIdx === -1 ? "" : body.slice(commaIdx + 1);

  // Parse remaining "k:v" pairs into a plain object
  const fields: Record<string, string> = {};
  for (const pair of rest.split(",")) {
    const colon = pair.indexOf(":");
    if (colon === -1) continue;
    fields[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
  }

  switch (type) {
    case "BATT": {
      const level = parseInt(fields["LEVEL"] ?? "", 10);
      if (!isNaN(level)) return { type: "BATT", level };
      break;
    }
    case "ID":
      return { type: "ID", value: fields["VALUE"] ?? rest };
    case "ACK":
      return { type: "ACK", id: fields["ID"] ?? "" };
    case "STATUS":
      return { type: "STATUS", fields };
    case "ERR":
      return { type: "ERR", message: fields["MSG"] ?? rest };
    case "MSG":
      return {
        type: "MSG",
        text: fields["TEXT"] ?? rest,
        receivedAt: Date.now(),
      };
    case "BCAST":
      return {
        type: "BCAST",
        text: fields["TEXT"] ?? rest,
        receivedAt: Date.now(),
      };
    case "SOS":
      return {
        type: "SOS",
        source: fields["SRC"] === "DEVICE" ? "DEVICE" : "APP",
        deviceId: fields["ID"] ?? "",
        lat: fields["LAT"] ?? "none",
        lng: fields["LNG"] ?? "none",
        receivedAt: Date.now(),
      };
  }

  return { type, raw: trimmed };
}

/**
 * Stateful line buffer — append raw chunks; `flush()` returns complete lines.
 * Handles any mix of \n and \r\n line endings.
 */
export class LineBuffer {
  private buf = "";

  append(chunk: string): string[] {
    this.buf += chunk;
    const lines = this.buf.split(/\r?\n/);
    this.buf = lines.pop() ?? ""; // last element is the incomplete tail
    return lines.filter((l) => l.length > 0);
  }

  clear() {
    this.buf = "";
  }
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface ITransport {
  readonly status: TransportStatus;

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(cb: StatusCallback): () => void;

  /**
   * Subscribe to parsed incoming frames from the ESP32.
   * Returns an unsubscribe function.
   */
  onFrameReceived(cb: FrameCallback): () => void;

  /** Start connection (scan → pair → open). Returns true on success. */
  connect(): Promise<boolean>;

  /** Close the connection gracefully. */
  disconnect(): Promise<void>;

  /** Send an SOS frame with optional GPS. */
  sendSOS(location?: { latitude: number; longitude: number }): Promise<void>;

  /** Send a structured text message. */
  sendMessage(opts: {
    text: string;
    urgency: "low" | "medium" | "critical";
    location?: { latitude: number; longitude: number };
  }): Promise<void>;
}
