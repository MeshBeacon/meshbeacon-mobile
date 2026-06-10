/**
 * USB Serial transport — communicates with the ESP32 over a USB-C cable.
 * Android only (uses react-native-usb-serialport-for-android).
 *
 * Message protocol (newline-terminated ASCII, sent as hex):
 *   SOS  → "CDK:SOS,LAT:<lat>,LNG:<lng>\n"
 *   MSG  → "CDK:MSG,URGENCY:<low|medium|critical>,LAT:<lat>,LNG:<lng>,TEXT:<text>\n"
 */

import { Platform } from "react-native";
// Import types only — they are erased at runtime and safe on iOS
import type { OpenOptions } from "react-native-usb-serialport-for-android";
import type UsbSerial from "react-native-usb-serialport-for-android/lib/typescript/usb_serial";
import type {
    FrameCallback,
    ITransport,
    StatusCallback,
    TransportStatus,
} from "./transport";
import { LineBuffer, parseIncomingLine } from "./transport";

// Load the native module only on Android. On iOS the module does not exist and
// accessing it would throw "Cannot read property 'getConstants' of null".

const _androidSerial =
  Platform.OS === "android"
    ? require("react-native-usb-serialport-for-android")
    : null;
const UsbSerialManager:
  | (typeof import("react-native-usb-serialport-for-android"))["UsbSerialManager"]
  | null = _androidSerial?.UsbSerialManager ?? null;
const Parity: (typeof import("react-native-usb-serialport-for-android"))["Parity"] =
  _androidSerial?.Parity ?? { None: 0, Odd: 1, Even: 2, Mark: 3, Space: 4 };

const DEFAULT_OPTIONS: OpenOptions = {
  baudRate: 115200,
  parity: Parity.None,
  dataBits: 8,
  stopBits: 1,
};

const FRAME_SOURCE = "CDK";

function toHex(str: string): string {
  let hex = "";
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

class SerialService implements ITransport {
  private port: UsbSerial | null = null;
  private deviceId: number | null = null;
  private subscribers: StatusCallback[] = [];
  private frameSubscribers: FrameCallback[] = [];
  private lineBuffer = new LineBuffer();
  private rxSubscription: ReturnType<UsbSerial["onReceived"]> | null = null;
  private _status: TransportStatus = "disconnected";
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  private startDisconnectPoll() {
    this._pollTimer = setInterval(async () => {
      if (this._status !== "connected" || this.deviceId === null) return;
      if (!UsbSerialManager) return; // only reachable on Android
      try {
        const devices = await UsbSerialManager.list();
        const stillConnected = devices.some(
          (d) => d.deviceId === this.deviceId,
        );
        if (!stillConnected) {
          console.warn("[CDK/Serial] Device unplugged — auto-disconnecting.");
          this.disconnect();
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
  }

  private stopDisconnectPoll() {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ── Status management ──────────────────────────────────────────────────────

  private setStatus(status: TransportStatus, detail?: string) {
    this._status = status;
    for (const cb of this.subscribers) cb(status, detail);
  }

  get status(): TransportStatus {
    return this._status;
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.subscribers.push(cb);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== cb);
    };
  }

  onFrameReceived(cb: FrameCallback): () => void {
    this.frameSubscribers.push(cb);
    return () => {
      this.frameSubscribers = this.frameSubscribers.filter((s) => s !== cb);
    };
  }

  private dispatchFrame(raw: string): void {
    const frame = parseIncomingLine(raw);
    if (!frame) return;
    for (const cb of this.frameSubscribers) cb(frame);
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  /**
   * List all connected USB devices and attempt to connect to the first one
   * (normally the ESP32). Returns true on success.
   */
  async connect(): Promise<boolean> {
    if (Platform.OS !== "android" || !UsbSerialManager) {
      this.setStatus("error", "USB serial is not supported on this platform.");
      return false;
    }
    try {
      this.setStatus("connecting");

      // ── 1. List USB devices ──────────────────────────────────────────────
      console.log("[CDK/Serial] Listing USB devices…");
      const devices = await UsbSerialManager.list();
      console.log(
        "[CDK/Serial] Devices found:",
        JSON.stringify(devices, null, 2),
      );

      if (devices.length === 0) {
        const msg =
          "No USB device found. Make sure the ESP32 is plugged in and the cable supports data transfer.";
        console.warn("[CDK/Serial]", msg);
        this.setStatus("error", msg);
        return false;
      }

      // ── 2. Request USB access permission ────────────────────────────────
      const device = devices[0];
      this.deviceId = device.deviceId;
      console.log(
        `[CDK/Serial] Requesting permission for device ${device.deviceId} (VID:${device.vendorId} PID:${device.productId})…`,
      );

      const hasPermission = await UsbSerialManager.tryRequestPermission(
        device.deviceId,
      );
      console.log("[CDK/Serial] Permission granted:", hasPermission);

      if (!hasPermission) {
        const msg =
          "USB permission denied. When the dialog appears, tap Allow and try again.";
        console.warn("[CDK/Serial]", msg);
        this.setStatus("error", msg);
        return false;
      }

      // ── 3. Open the serial port ──────────────────────────────────────────
      console.log("[CDK/Serial] Opening port at 115200 baud…");
      this.port = await UsbSerialManager.open(device.deviceId, DEFAULT_OPTIONS);
      console.log("[CDK/Serial] Port opened.");

      // ── 4. Subscribe to incoming data ────────────────────────────────────
      this.lineBuffer.clear();
      this.rxSubscription = this.port.onReceived(({ data }) => {
        // data arrives as a hex string — decode to ASCII
        const ascii =
          data
            .match(/.{1,2}/g)
            ?.map((b) => String.fromCharCode(parseInt(b, 16)))
            .join("") ?? "";
        console.log("[CDK/Serial] RX:", JSON.stringify(ascii));
        for (const line of this.lineBuffer.append(ascii)) {
          this.dispatchFrame(line);
        }
      });

      this.setStatus("connected");
      this.startDisconnectPoll();
      // Greet the device so it knows the phone is connected immediately
      // (device waits for any CDK: frame to trigger its "USB connected" splash).
      await this.sendRaw("CDK:HELLO").catch(() => {});
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CDK/Serial] connect() error:", message);
      this.setStatus("error", message);
      this.port = null;
      this.deviceId = null;
      return false;
    }
  }

  private _disconnecting = false;

  async disconnect(): Promise<void> {
    // Guard against re-entrant calls: sendRaw() calls disconnect() on send
    // failure, which would otherwise loop if we send CDK:BYE here.
    if (this._disconnecting) return;
    this._disconnecting = true;
    this.stopDisconnectPoll();
    // Notify the device before closing the port so it can show a
    // "USB disconnected" splash immediately instead of waiting for
    // its 30-second idle-timeout heuristic.
    try { await this.sendRaw("CDK:BYE"); } catch { /* cable may already be unplugged */ }
    try {
      this.rxSubscription?.remove();
      this.rxSubscription = null;
      await this.port?.close();
    } catch {
      // best effort
    }
    this.lineBuffer.clear();
    this.port = null;
    this.deviceId = null;
    this._disconnecting = false;
    this.setStatus("disconnected");
  }

  // ── Sending helpers ────────────────────────────────────────────────────────

  private async sendRaw(message: string): Promise<void> {
    if (!this.port) {
      throw new Error("Not connected to an ESP32 device.");
    }
    // Append newline so the ESP32 can use Serial.readStringUntil('\n')
    const frame = message.endsWith("\n") ? message : message + "\n";
    try {
      await this.port.send(toHex(frame));
    } catch (err) {
      // Send failed — cable likely unplugged
      console.warn("[CDK/Serial] send failed, disconnecting:", err);
      this.disconnect();
      throw err;
    }
  }

  /**
   * Send an SOS alert with optional GPS coordinates.
   */
  async sendSOS(location?: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
  }): Promise<void> {
    const lat = location ? location.latitude.toFixed(6) : "none";
    const lng = location ? location.longitude.toFixed(6) : "none";
    let frame = `${FRAME_SOURCE}:SOS,LAT:${lat},LNG:${lng}`;
    if (location) {
      if (location.altitude != null)
        frame += `,ALT:${location.altitude.toFixed(1)}`;
      if (location.speed != null)
        frame += `,SPD:${(location.speed * 3.6).toFixed(1)}`;
      if (location.heading != null)
        frame += `,HDG:${location.heading.toFixed(1)}`;
    }
    await this.sendRaw(frame);
  }
  async sendMessage(opts: {
    text: string;
    urgency: "low" | "medium" | "critical";
    location?: { latitude: number; longitude: number };
  }): Promise<void> {
    const urgencyCode =
      opts.urgency === "low" ? 0 : opts.urgency === "medium" ? 1 : 2;
    const lat = opts.location ? opts.location.latitude.toFixed(6) : "none";
    const lng = opts.location ? opts.location.longitude.toFixed(6) : "none";
    // Sanitise text: strip commas so the simple CSV protocol stays intact
    const text = opts.text.replace(/,/g, ";").trim();
    const frame = `${FRAME_SOURCE}:MSG,URGENCY:${urgencyCode},LAT:${lat},LNG:${lng},TEXT:${text}`;
    await this.sendRaw(frame);
  }

  /**
   * Send a direct MamaDuck-to-MamaDuck chat message (LoRa topic 26, MTALK).
   * targetId must be exactly 8 characters — the DUCK_NAME of the remote MamaDuck.
   */
  async sendMTalk(
    targetId: string,
    text: string,
    location?: { latitude: number; longitude: number },
    mid?: string,
  ): Promise<void> {
    if (targetId.length !== 8) {
      throw new Error("MTALK target ID must be exactly 8 characters.");
    }
    const sanitised = text.replace(/,/g, ";").trim();
    const lat = location ? location.latitude.toFixed(6) : "none";
    const lng = location ? location.longitude.toFixed(6) : "none";
    const midSuffix = mid ? `,MID:${mid}` : "";
    await this.sendRaw(
      `${FRAME_SOURCE}:MTALK,TARGET:${targetId},LAT:${lat},LNG:${lng},TEXT:${sanitised}${midSuffix}`,
    );
  }

  async sendGps(location?: {
    latitude: number;
    longitude: number;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
  }): Promise<void> {
    const lat = location ? location.latitude.toFixed(6) : "none";
    const lng = location ? location.longitude.toFixed(6) : "none";
    let frame = `${FRAME_SOURCE}:GPS,LAT:${lat},LNG:${lng}`;
    if (location) {
      if (location.altitude != null)
        frame += `,ALT:${location.altitude.toFixed(1)}`;
      if (location.speed != null)
        frame += `,SPD:${(location.speed * 3.6).toFixed(1)}`;
      if (location.heading != null)
        frame += `,HDG:${location.heading.toFixed(1)}`;
    }
    await this.sendRaw(frame);
  }
}

export const serialService = new SerialService();

// Re-export type alias so old import sites still compile
export type { TransportStatus as SerialStatus };
