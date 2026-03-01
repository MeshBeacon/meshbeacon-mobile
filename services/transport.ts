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
/**
 * Direct MamaDuck-to-MamaDuck chat message (LoRa topic 26).
 * Received when another MamaDuck sends an MTALK packet addressed to this duck.
 * `lat` and `lng` are present when the sender attached their GPS location.
 */
export type MTalkFrame = {
  type: "MTALK";
  /**
   * Sender duck ID (DUID) forwarded by the firmware via the `DUID=` field.
   * Undefined when the firmware does not include it.
   */
  from?: string;
  text: string;
  /** GPS latitude string, e.g. "3.140000", or "none" / undefined when not sent. */
  lat?: string;
  /** GPS longitude string, e.g. "101.686000", or "none" / undefined when not sent. */
  lng?: string;
  /** Message ID echoed back in the MACK receipt (present when firmware v2+ sent this). */
  mid?: string;
  receivedAt: number;
};
/** Delivery receipt — the receiver's firmware sends this back to the sender after
 * successfully receiving an MTALK that carried a MID field. */
export type MackFrame = {
  type: "MACK";
  /** The MID from the original MTALK that is being acknowledged. */
  id: string;
  /** Duck ID of the peer who received and acknowledged the message. */
  from: string;
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
  | MTalkFrame
  | MackFrame
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
    case "MTALK": {
      const lat = fields["LAT"];
      const lng = fields["LNG"];
      // Accept a coordinate only when it is present, not the literal "none",
      // and actually parses as a finite number.  Any other value (empty string,
      // garbage bytes, scientific-notation overflow, etc.) is silently dropped
      // so the UI never displays NaN or wrong data.
      const validLat =
        lat && lat !== "none" && isFinite(parseFloat(lat)) ? lat : undefined;
      const validLng =
        lng && lng !== "none" && isFinite(parseFloat(lng)) ? lng : undefined;
      return {
        type: "MTALK",
        ...(fields["DUID"] ? { from: fields["DUID"] } : {}),
        text: fields["TEXT"] ?? rest,
        ...(fields["MID"] ? { mid: fields["MID"] } : {}),
        ...(validLat !== undefined ? { lat: validLat } : {}),
        ...(validLng !== undefined ? { lng: validLng } : {}),
        receivedAt: Date.now(),
      };
    }
    case "MACK":
      return {
        type: "MACK",
        id: fields["ID"] ?? "",
        from: fields["DUID"] ?? "",
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

  /**
   * Send a direct MamaDuck-to-MamaDuck chat message (MTALK, LoRa topic 26).
   * targetId must be exactly 8 characters — the DUCK_NAME of the remote MamaDuck.
   * Optionally attach GPS coordinates so the recipient knows the sender's position.
   * Optionally provide a `mid` (message ID) so the receiver firmware sends back a
   * CDK:MACK delivery receipt.
   */
  sendMTalk(
    targetId: string,
    text: string,
    location?: { latitude: number; longitude: number },
    mid?: string,
  ): Promise<void>;
}
