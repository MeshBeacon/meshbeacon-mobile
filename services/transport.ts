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
   * Sender duck ID forwarded by the firmware via the `FROM=` field.
   * Set by MamaDuck.ino from `packet.sduid` (the LoRa source DUID).
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
/**
 * Sent by the ESP32 when it needs the phone's GPS location.
 * The app should respond with CDK:GPS,LAT:<lat>,LNG:<lng>\n.
 * Occurs on boards with no built-in GPS module, or when the module has no fix.
 */
/**
 * Firmware confirms it dispatched a LoRa PING in response to CDK:SCAN.
 * `status` is "ping_sent" (success) or "ping_failed" (NetworkState not PUBLIC).
 */
export type ScanAckFrame = {
  type: "SCAN_ACK";
  /** "ping_sent" | "ping_failed" */
  status: string;
  receivedAt: number;
};
export type GpsReqFrame = { type: "GPSREQ" };
/**
 * Confirmation that the operator's system (OpenDMS) received the SOS.
 * Broadcast by the firmware when it receives topic-22 "SOS DITERIMA" from the hub.
 */
export type SosAckFrame = {
  type: "SOS_ACK";
  text: string;
  receivedAt: number;
};
/**
 * Reply to CDK:RADIOREGION — sent by the firmware either in response to a
 * query (no VALUE sent by the app) or after a write.  A successful write
 * always sets `rebootRequired: true`; the new region is not applied until the
 * device reboots.  `error` is present only when a write was rejected.
 */
export type RadioRegionFrame = {
  type: "RADIOREGION";
  /** Region code, e.g. "MY", "US". Present on query replies and write acks. */
  value?: string;
  /** "ok" on a successful write. */
  status?: string;
  /** True when a region was just written and the device must reboot to apply it. */
  rebootRequired?: boolean;
  /** "unknown_region" | "write_failed" — present only when a write was rejected. */
  error?: string;
};

/** LoRa region presets supported by the firmware, for use in region-picker UI. */
export const RADIO_REGIONS: { code: string; label: string }[] = [
  { code: "MY", label: "Malaysia" },
  { code: "SG", label: "Singapore" },
  { code: "PH", label: "Philippines" },
  { code: "ID", label: "Indonesia" },
  { code: "US", label: "United States" },
  { code: "UK", label: "United Kingdom" },
  { code: "PSE", label: "Palestine" },
];
/**
 * Emitted by the firmware whenever it receives a packet from another duck.
 * Used by the app to populate the Nearby Ducks list in the Nearby screen.
 *
 *   CDK:SEEN,ID:DUCK0001,TYPE:MAMA\n
 *
 * TYPE values mirror CDP DuckType: MAMA, LINK, PAPA, DETC, UNKN.
 */
export type SeenFrame = {
  type: "SEEN";
  /** 8-character ASCII Duck ID of the peer that was seen. */
  duckId: string;
  /** Duck type string: "MAMA" | "LINK" | "PAPA" | "DETC" | "UNKN" */
  duckType: string;
  /** GPS latitude from the duck's last known position (if available). */
  lat?: number;
  /** GPS longitude from the duck's last known position (if available). */
  lng?: number;
  /**
   * Whether that duck currently has an operator's phone attached via
   * USB/BLE, as last reported in its mesh BEACON/BEACON_ACK (PHONE: field).
   * Undefined when the firmware hasn't reported this yet (e.g. older
   * firmware, or no fresh BEACON heard from that duck).
   */
  phoneConnected?: boolean;
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
  | MTalkFrame
  | MackFrame
  | GpsReqFrame
  | SosAckFrame
  | ScanAckFrame
  | SeenFrame
  | RadioRegionFrame
  | UnknownFrame;

export type FrameCallback = (frame: IncomingFrame) => void;

// ── Outbound text sanitisation ────────────────────────────────────────────────

/**
 * Normalise free-text message bodies before they're embedded in a CDK: frame.
 *
 * - Commas are replaced with semicolons so the CSV-style frame isn't broken.
 * - Curly/typographic quotes that iOS and Android keyboards silently
 *   substitute for straight quotes (the "smart punctuation" autocorrect
 *   feature — there is no React Native prop to disable it) are mapped back
 *   to plain ASCII. Both transports encode TEXT one "byte" per UTF-16 code
 *   unit (hex pairs over USB serial, `btoa()` over BLE); any character above
 *   code point 255 either corrupts the frame or throws outright, which is
 *   why typing an apostrophe appeared to silently fail to send.
 */
export function sanitizeFrameText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/,/g, ";")
    .trim();
}

/**
 * Encode a JS string as UTF-8 and return it as a "binary string" — one JS
 * char per output byte (code 0–255). This is the representation the wire
 * encoders (`toHex` in serial.ts, `toBase64` in ble.ts) expect, since both
 * assume one byte per character. Pure ASCII input passes through unchanged.
 * Lets non-ASCII TEXT content (emoji, accented letters, CJK, etc.) survive
 * the byte-oriented hex/base64 encodings instead of corrupting the frame.
 */
export function utf8Encode(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    let codePoint = str.charCodeAt(i);
    // Combine a valid UTF-16 surrogate pair (e.g. emoji) into one code point.
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + (codePoint - 0xd800) * 0x400 + (low - 0xdc00);
        i++;
      }
    }
    if (codePoint < 0x80) {
      out += String.fromCharCode(codePoint);
    } else if (codePoint < 0x800) {
      out += String.fromCharCode(
        0xc0 | (codePoint >> 6),
        0x80 | (codePoint & 0x3f),
      );
    } else if (codePoint < 0x10000) {
      out += String.fromCharCode(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      out += String.fromCharCode(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return out;
}

/**
 * Decode a "binary string" (one char per raw byte, 0–255) produced by the
 * hex/base64 wire decoders back into a proper JS Unicode string. Inverse of
 * `utf8Encode`. Malformed/truncated sequences fall back to the raw byte
 * value per char rather than throwing, so a corrupted frame never crashes
 * the receive pipeline.
 */
export function utf8Decode(bin: string): string {
  let out = "";
  let i = 0;
  while (i < bin.length) {
    const b0 = bin.charCodeAt(i);
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i++;
      continue;
    }
    if (b0 >= 0xc2 && b0 <= 0xdf && i + 1 < bin.length) {
      const b1 = bin.charCodeAt(i + 1);
      if ((b1 & 0xc0) === 0x80) {
        out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
        i += 2;
        continue;
      }
    } else if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < bin.length) {
      const b1 = bin.charCodeAt(i + 1);
      const b2 = bin.charCodeAt(i + 2);
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        out += String.fromCharCode(
          ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
        );
        i += 3;
        continue;
      }
    } else if (b0 >= 0xf0 && b0 <= 0xf4 && i + 3 < bin.length) {
      const b1 = bin.charCodeAt(i + 1);
      const b2 = bin.charCodeAt(i + 2);
      const b3 = bin.charCodeAt(i + 3);
      if (
        (b1 & 0xc0) === 0x80 &&
        (b2 & 0xc0) === 0x80 &&
        (b3 & 0xc0) === 0x80
      ) {
        let cp =
          ((b0 & 0x07) << 18) |
          ((b1 & 0x3f) << 12) |
          ((b2 & 0x3f) << 6) |
          (b3 & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        i += 4;
        continue;
      }
    }
    // Not a valid/complete UTF-8 sequence — keep the raw byte so data is
    // never silently dropped.
    out += String.fromCharCode(b0);
    i++;
  }
  return out;
}

/**
 * Append the trailing newline, UTF-8-encode the frame to a wire-ready
 * "binary string", and verify it still fits within MAX_FRAME_BYTES. Non-ASCII
 * characters expand to multiple bytes, so this must be checked post-encoding
 * rather than against the original string length.
 */
export function encodeFrameForWire(frame: string): string {
  const withNewline = frame.endsWith("\n") ? frame : frame + "\n";
  const encoded = utf8Encode(withNewline);
  if (encoded.length > MAX_FRAME_BYTES) {
    throw new Error(
      `Message too long once encoded (${encoded.length} bytes, max ${MAX_FRAME_BYTES}). ` +
        "Shorten it — emoji and non-Latin characters use multiple bytes each.",
    );
  }
  return encoded;
}

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

  // Parse remaining "k:v" pairs into a plain object.
  // Values may contain commas (e.g. free-text messages), so we cannot simply
  // split on ",".  Instead, locate every key boundary — an ALL-CAPS identifier
  // preceded by "," or the start of the string — and treat everything between
  // one key's value-start and the next key's boundary as that key's value.
  const fields: Record<string, string> = {};
  const kvRe = /(^|,)([A-Z0-9_]+):/g;
  const kvEntries: Array<{
    key: string;
    valueStart: number;
    matchStart: number;
  }> = [];
  let kvMatch: RegExpExecArray | null;
  while ((kvMatch = kvRe.exec(rest)) !== null) {
    kvEntries.push({
      key: kvMatch[2],
      valueStart: kvMatch.index + kvMatch[0].length,
      matchStart: kvMatch.index,
    });
  }
  for (let i = 0; i < kvEntries.length; i++) {
    const end =
      i + 1 < kvEntries.length ? kvEntries[i + 1].matchStart : rest.length;
    fields[kvEntries[i].key] = rest.slice(kvEntries[i].valueStart, end).trim();
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
    case "PMSG": // topic 25 — personal message; same shape as MSG
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
        ...(fields["FROM"] ? { from: fields["FROM"] } : {}),
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
        from: fields["FROM"] ?? "",
      };
    case "SEEN": {
      const lat = fields["LAT"];
      const lng = fields["LNG"];
      const validLat =
        lat && lat !== "none" && isFinite(parseFloat(lat)) ? parseFloat(lat) : undefined;
      const validLng =
        lng && lng !== "none" && isFinite(parseFloat(lng)) ? parseFloat(lng) : undefined;
      const phone = fields["PHONE"];
      const phoneConnected = phone === "1" ? true : phone === "0" ? false : undefined;
      return {
        type: "SEEN",
        duckId: fields["ID"] ?? "",
        duckType: fields["TYPE"] ?? "UNKN",
        ...(validLat !== undefined ? { lat: validLat } : {}),
        ...(validLng !== undefined ? { lng: validLng } : {}),
        ...(phoneConnected !== undefined ? { phoneConnected } : {}),
        receivedAt: Date.now(),
      };
    }
    case "SCAN_ACK":
      return {
        type: "SCAN_ACK",
        status: fields["SCAN"] ?? "ping_sent",
        receivedAt: Date.now(),
      };
    case "GPSREQ":
      return { type: "GPSREQ" };
    case "SOS_ACK":
      return {
        type: "SOS_ACK",
        text: fields["TEXT"] ?? rest,
        receivedAt: Date.now(),
      };
    case "RADIOREGION":
      return {
        type: "RADIOREGION",
        ...(fields["VALUE"] ? { value: fields["VALUE"] } : {}),
        ...(fields["STATUS"] ? { status: fields["STATUS"] } : {}),
        ...(fields["REBOOT_REQUIRED"] === "1" ? { rebootRequired: true } : {}),
        ...(fields["ERROR"] ? { error: fields["ERROR"] } : {}),
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
    // Each popped line is the full raw byte sequence for one frame (as a
    // "binary string", one char per byte) — UTF-8-decode it here so non-ASCII
    // TEXT content round-trips correctly. Splitting on \n above is byte-safe
    // since 0x0A never appears as a UTF-8 continuation/lead byte.
    return lines.filter((l) => l.length > 0).map(utf8Decode);
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
  sendSOS(location?: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    /** Speed in m/s as reported by the OS. */
    speed?: number | null;
    heading?: number | null;
  }): Promise<void>;

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

  /**
   * Reply to a GPSREQ frame with the phone's current GPS coordinates.
   * Omit `location` when GPS is unavailable — the ESP32 will receive LAT:none,LNG:none.
   * Include altitude (m), speed (m/s — firmware converts to km/h), and heading (°) when available.
   */
  sendGps(location?: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    /** Speed in m/s as reported by the OS. Converted to km/h (×3.6) before sending. */
    speed?: number | null;
    heading?: number | null;
  }): Promise<void>;
  /** Broadcast a LoRa PING so nearby ducks respond and appear in the Nearby list. */
  sendScan(): Promise<void>;

  /**
   * Query or change the device's LoRa region preset.
   * Omit `code` to query the current region. The device replies with a
   * CDK:RADIOREGION frame (see RadioRegionFrame). A successful write requires
   * a device reboot before the new region actually takes effect.
   */
  sendRadioRegion(code?: string): Promise<void>;
}
