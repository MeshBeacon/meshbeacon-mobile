/**
 * BLE transport — connects to an ESP32 running Nordic UART Service (NUS).
 *
 * NUS UUIDs (standard, works with ArduinoBLE / NimBLE-Arduino / ESP-IDF):
 *   Service  : 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   RX char  : 6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (phone writes → ESP32 receives)
 *   TX char  : 6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (ESP32 sends  → phone reads)
 *
 * The same CDK: frame protocol is used as with USB serial.
 */

import { PermissionsAndroid, Platform } from "react-native";
import { BleError, BleManager, Device, State } from "react-native-ble-plx";
import type {
    FrameCallback,
    ITransport,
    StatusCallback,
    TransportStatus,
} from "./transport";
import { LineBuffer, parseIncomingLine } from "./transport";

// ── NUS constants ──────────────────────────────────────────────────────────────
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX_CHAR = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // phone writes here
const NUS_TX_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // ESP32 sends here

const SCAN_TIMEOUT_MS = 30_000;
const FRAME_SOURCE = "CDK";

/**
 * ClusterDuck device names follow patterns like:
 *   ZAIHAN12, DUCK-01, MAMA-03, PAPA-DUCK, etc.
 * We match any name that starts with a known prefix or contains "DUCK".
 */
function isClusterDuckDevice(name: string): boolean {
  const upper = name.toUpperCase();
  // ClusterDuck Protocol enforces DUCK_NAME = exactly 8 bytes
  // (e.g. "MAMADUCK", "MNZAIHAN", "NRLIZAMD", "ZAIHAN12").
  // Strictly reject anything not 8 uppercase alphanumeric characters.
  if (/^[A-Z0-9]{8}$/.test(upper)) return true;
  // Also keep legacy/longer prefixes for development builds.
  return (
    upper.includes("DUCK") ||
    upper.includes("MAMA") ||
    upper.includes("PAPA") ||
    upper.startsWith("ZAIHAN") ||
    upper.startsWith("CDK")
  );
}
export interface ScannedDevice {
  id: string;
  name: string;
  rssi: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Encode a plain ASCII string to base64 (BLE-PLX requires base64). */
function toBase64(str: string): string {
  // All CDK frames are pure ASCII (0–127).  btoa() handles ASCII natively
  // and is available on both JavaScriptCore (iOS) and Hermes (Android ≥ RN 0.71).
  // Using btoa(str) directly — without the unescape(encodeURIComponent()) wrapper
  // — avoids the deprecated `unescape` global which Hermes may handle differently
  // from JavaScriptCore on non-ASCII sequences.
  if (typeof btoa !== "undefined") return btoa(str);
  // Pure-JS fallback for environments where btoa is absent
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  let i = 0;
  while (i < str.length) {
    const a = str.charCodeAt(i++);
    const b = i < str.length ? str.charCodeAt(i++) : 0;
    const c = i < str.length ? str.charCodeAt(i++) : 0;
    result +=
      chars[a >> 2] +
      chars[((a & 3) << 4) | (b >> 4)] +
      (i - 2 < str.length ? chars[((b & 15) << 2) | (c >> 6)] : "=") +
      (i - 1 < str.length ? chars[c & 63] : "=");
  }
  return result;
}

/**
 * Decode a base64 string to an ASCII/Latin-1 string.
 *
 * WHY NOT atob():
 * BLE-PLX delivers each GATT notification chunk as a separately base64-encoded
 * value.  When the ESP32's NimBLE ATT_MTU is small (default 23 bytes → 20 bytes
 * payload) a single CDK frame is fragmented across multiple notify events.
 * Each chunk's base64 form is NOT a multiple of 4 characters, so the boundary
 * between chunks lands in the middle of a base64 group.  Calling atob() on such
 * a partial block is undefined behaviour: iOS (JavaScriptCore) silently zero-pads
 * it while Hermes (Android) either throws or drops the last 1–2 bytes.  The
 * mismatch produces garbled bytes that end up as garbage coordinate values.
 *
 * SOLUTION: accumulate raw base64 characters in a separate string buffer; only
 * decode once a complete newline-terminated line has been detected in the decoded
 * ASCII output.  Because we process the raw base64 accumulator in 4-char groups
 * (the natural base64 unit), we never decode across a chunk boundary.
 *
 * This pure-JS implementation is identical on every platform.
 */
function fromBase64(b64: string): string {
  const table =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  // Strip any whitespace / line-breaks that may appear in base64 strings
  const s = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  for (let i = 0; i < s.length; i += 4) {
    const a = table.indexOf(s[i]);
    const b = table.indexOf(s[i + 1]);
    const c = table.indexOf(s[i + 2] ?? "=");
    const d = table.indexOf(s[i + 3] ?? "=");
    if (a < 0 || b < 0) break; // malformed — stop
    result += String.fromCharCode((a << 2) | (b >> 4));
    if (c >= 0 && s[i + 2] !== "=")
      result += String.fromCharCode(((b & 0xf) << 4) | (c >> 2));
    if (d >= 0 && s[i + 3] !== "=")
      result += String.fromCharCode(((c & 0x3) << 6) | d);
  }
  return result;
}

/** Request Android runtime permissions needed for BLE scanning/connecting.
 *  Android 12+ (API 31+): BLUETOOTH_SCAN + BLUETOOTH_CONNECT
 *  Android 6–11 (API 23–30): ACCESS_FINE_LOCATION (required for BLE scan results)
 *  Returns true only when all required permissions are granted.
 */
async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  if (Platform.Version >= 31) {
    // Android 12+
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === "granted" &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === "granted"
    );
  } else {
    // Android 6–11: BLE scan requires location
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
}

// ── BLE Service ───────────────────────────────────────────────────────────────

class BleService implements ITransport {
  private manager: BleManager | null = null;
  private device: Device | null = null;
  private subscribers: StatusCallback[] = [];
  private frameSubscribers: FrameCallback[] = [];
  private lineBuffer = new LineBuffer();
  private rxSubscription: ReturnType<
    Device["monitorCharacteristicForService"]
  > | null = null;
  private _status: TransportStatus = "disconnected";
  /** Usable bytes per BLE write = negotiated ATT_MTU − 3. Default is the BLE minimum. */
  private mtuPayload = 20;

  /** Lazily create BleManager so it is never instantiated at module-load time. */
  private getManager(): BleManager {
    if (!this.manager) this.manager = new BleManager();
    return this.manager;
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

  async connect(targetDeviceId?: string): Promise<boolean> {
    try {
      // 0. Stop any in-progress scan immediately — Android GATT stack rejects
      //    connection attempts while a scan is still active on some chipsets.
      this.getManager().stopDeviceScan();

      // 1. Android runtime permissions
      if (Platform.OS === "android") {
        const granted = await requestAndroidBlePermissions();
        if (!granted) {
          this.setStatus(
            "error",
            "Bluetooth permissions denied. Enable in Settings.",
          );
          return false;
        }
      }

      // 2. Wait for Bluetooth adapter to be powered on (up to 5 s)
      const ready = await this.waitForBluetoothReady(5_000);
      if (!ready) {
        this.setStatus(
          "error",
          "Bluetooth is off. Please enable it and try again.",
        );
        return false;
      }

      // 3. Connect to a specific device, or scan for the first NUS device found
      let connectedDevice: Device;
      if (targetDeviceId) {
        this.setStatus("connecting");
        // On Android, a short pause after stopping the scan lets the BLE stack
        // fully release the scanner before opening a GATT connection.
        // Without this, many Android chipsets return GATT error 133
        // ("device not found") even though we just saw the device advertising.
        if (Platform.OS === "android") {
          await new Promise<void>((r) => setTimeout(r, 300));
        }
        connectedDevice = await this.getManager().connectToDevice(
          targetDeviceId,
          { autoConnect: false, timeout: 10_000 },
        );
      } else {
        this.setStatus("scanning");
        const found = await this.scanForDevice(SCAN_TIMEOUT_MS);
        if (!found) {
          this.setStatus(
            "error",
            "ESP32 not found. Make sure Bluetooth is enabled on the device.",
          );
          return false;
        }
        this.setStatus("connecting");
        connectedDevice = await found.connect({ autoConnect: false });
      }

      this.device = connectedDevice;
      await this.device.discoverAllServicesAndCharacteristics();

      // 5. Request larger MTU so long frames fit in one packet.
      //    Store the result so sendRaw can chunk correctly.
      try {
        const updatedDevice = await this.device.requestMTU(512);
        // ATT payload = total MTU − 3 bytes overhead; clamp between 20 and 256.
        const negotiated = updatedDevice.mtu ?? 23;
        this.mtuPayload = Math.min(256, Math.max(20, negotiated - 3));
      } catch {
        this.mtuPayload = 20; // conservative fallback
      }

      // 6. Monitor disconnections
      this.device.onDisconnected(() => {
        this.rxSubscription = null;
        this.device = null;
        this.lineBuffer.clear();
        this.setStatus("disconnected");
      });

      // 7. Subscribe to incoming frames from the ESP32 (NUS TX characteristic)
      this.lineBuffer.clear();
      this.rxSubscription = this.device.monitorCharacteristicForService(
        NUS_SERVICE,
        NUS_TX_CHAR,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          try {
            // Use our own pure-JS decoder instead of atob() so the byte
            // interpretation is identical on iOS (JavaScriptCore) and Android
            // (Hermes).  atob() is available on both but its handling of the
            // padding that BLE-PLX adds can differ when the underlying BLE
            // stack fragments a notify across multiple ATT PDUs.
            const decoded = fromBase64(characteristic.value);
            if (!decoded) return;
            for (const line of this.lineBuffer.append(decoded)) {
              this.dispatchFrame(line);
            }
          } catch (decodeErr) {
            console.warn("[CDK/BLE] base64 decode error:", decodeErr);
          }
        },
      );

      this.setStatus("connected");

      // Actively request device identity now that subscription is live.
      // handleFrame() on the sketch re-broadcasts CDK:ID on any incoming frame.
      setTimeout(async () => {
        try {
          await this.sendRaw("CDK:PING");
        } catch {
          /* ignore */
        }
      }, 300);

      return true;
    } catch (err: unknown) {
      const detail =
        err instanceof BleError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      this.device = null;
      this.setStatus("error", detail);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.rxSubscription?.remove();
      this.rxSubscription = null;
      await this.device?.cancelConnection();
    } catch {
      // best effort
    }
    this.lineBuffer.clear();
    this.device = null;
    this.mtuPayload = 20;
    this.setStatus("disconnected");
  }

  // ── Sending helpers ────────────────────────────────────────────────────────

  private async sendRaw(frame: string): Promise<void> {
    if (!this.device) throw new Error("Not connected to an ESP32 device.");
    const payload = frame.endsWith("\n") ? frame : frame + "\n";

    // The ESP32's NUS implementation delivers each GATT write as a separate
    // callback — it does NOT reassemble multiple writes into one frame.
    // Chunking therefore breaks the protocol: each partial chunk looks like
    // a malformed/incomplete CDK: frame and is silently dropped.
    //
    // The correct approach is always one write per frame, which works as long
    // as the payload fits within the negotiated ATT MTU payload (mtuPayload).
    // MTU negotiation (requestMTU(512)) typically yields 182–509 usable bytes
    // on modern Android/iOS, far above our 256-byte frame cap.
    // The payload is base64-encoded before writing. base64 expands the data by
    // 4/3 — the actual bytes on the wire are ceil(N/3)*4, not N.
    // Check against the encoded size so we never send a write that exceeds the
    // negotiated ATT MTU payload.
    const encodedLen = Math.ceil(payload.length / 3) * 4;
    if (encodedLen > this.mtuPayload) {
      throw new Error(
        `Frame too large for BLE MTU: ${encodedLen} B (base64) > ${this.mtuPayload} B. ` +
          "Shorten the message or reconnect to renegotiate MTU.",
      );
    }

    await this.device.writeCharacteristicWithResponseForService(
      NUS_SERVICE,
      NUS_RX_CHAR,
      toBase64(payload),
    );
  }

  async sendSOS(location?: {
    latitude: number;
    longitude: number;
  }): Promise<void> {
    const lat = location ? location.latitude.toFixed(6) : "none";
    const lng = location ? location.longitude.toFixed(6) : "none";
    await this.sendRaw(`${FRAME_SOURCE}:SOS,LAT:${lat},LNG:${lng}`);
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
      `CDK:MTALK,TARGET:${targetId},LAT:${lat},LNG:${lng},TEXT:${sanitised}${midSuffix}`,
    );
  }

  // ── Scan for devices ───────────────────────────────────────────────────────

  /**
   * Scan for nearby ClusterDuck devices advertising NUS.
   * Calls onFound for each new device discovered.
   * Returns a stop function — call it to end the scan early.
   *
   * Pass timeoutMs > 0 to auto-stop after that duration; omit (or pass 0) for
   * a continuous scan that runs until the returned stop() is called.
   */
  scanDevices(
    onFound: (d: ScannedDevice) => void,
    timeoutMs = 0,
    onComplete?: () => void,
  ): () => void {
    // Two-phase confirmation:
    //  1. A device enters `candidates` when its name matches the 8-char CDP rule
    //     (primary advertising packet — always the first event received).
    //  2. It is confirmed immediately when its serviceUUIDs contains the NUS UUID
    //     (scan response — arrives on a subsequent allowDuplicates event).
    //  3. Each candidate has a 3-second per-device fallback timer: if the scan
    //     response never arrives, the device is shown anyway so no duck is missed.
    const CANDIDATE_FLUSH_MS = 3_000;
    const candidates = new Map<string, ScannedDevice>();
    const candidateTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const uuidSeen = new Set<string>(); // NUS UUID confirmed but name not yet received
    const seen = new Set<string>();
    const mgr = this.getManager();
    let stopped = false;
    let globalTimer: ReturnType<typeof setTimeout> | null = null;
    let stateSub: { remove: () => void } | null = null;

    const confirm = (id: string) => {
      if (seen.has(id)) return;
      const d = candidates.get(id);
      if (!d) return;
      clearTimeout(candidateTimers.get(id));
      candidateTimers.delete(id);
      seen.add(id);
      onFound(d);
    };

    const startScan = () => {
      if (stopped) return;
      mgr.startDeviceScan(
        null, // no hardware UUID filter — buggy on some Android chipsets
        { allowDuplicates: true },
        (err, device) => {
          if (err || !device) return;
          if (seen.has(device.id)) return;

          const name = device.name ?? device.localName;
          const hasNUS =
            device.serviceUUIDs?.some(
              (u) => u.toLowerCase() === NUS_SERVICE,
            ) ?? false;

          // Remember if NUS UUID was seen before the name arrived (old firmware:
          // name is in scan response, UUID is in primary ad — opposite order).
          if (hasNUS) uuidSeen.add(device.id);

          // Phase 1: name matches CDP 8-char rule → add to candidates.
          if (name && isClusterDuckDevice(name) && !candidates.has(device.id)) {
            candidates.set(device.id, {
              id: device.id,
              name,
              rssi: device.rssi ?? -99,
            });
            if (uuidSeen.has(device.id)) {
              // UUID already confirmed before name arrived — confirm immediately.
              confirm(device.id);
            } else {
              // Fallback: show this device after 3 s even if NUS UUID never arrives.
              candidateTimers.set(
                device.id,
                setTimeout(() => confirm(device.id), CANDIDATE_FLUSH_MS),
              );
            }
          }

          // Phase 2: NUS UUID in scan response → confirm if name already known.
          if (hasNUS) confirm(device.id);
        },
      );
      // Optional global timeout — only set when caller requests it.
      if (timeoutMs > 0) {
        globalTimer = setTimeout(() => {
          mgr.stopDeviceScan();
          for (const id of candidates.keys()) confirm(id);
          onComplete?.();
        }, timeoutMs);
      }
    };

    // Request Android BLE/location permissions first, then wait for the
    // adapter to be PoweredOn before starting the scan.
    // onStateChange with emitCurrentValue=true fires immediately — if the
    // adapter is already on (typical on Android), startScan() is called
    // synchronously after permissions resolve.
    requestAndroidBlePermissions().then((granted) => {
      if (!granted || stopped) return;
      stateSub = mgr.onStateChange((state) => {
        if (state === State.PoweredOn) {
          stateSub?.remove();
          stateSub = null;
          startScan();
        }
      }, true); // true = emit current state immediately
    });

    return () => {
      stopped = true;
      stateSub?.remove();
      stateSub = null;
      if (globalTimer !== null) clearTimeout(globalTimer);
      for (const t of candidateTimers.values()) clearTimeout(t);
      candidateTimers.clear();
      uuidSeen.clear();
      mgr.stopDeviceScan();
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Resolve true once the BT adapter is PoweredOn; false on timeout. */
  private waitForBluetoothReady(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        sub.remove();
        resolve(false);
      }, timeoutMs);

      const sub = this.getManager().onStateChange((state) => {
        if (state === State.PoweredOn) {
          clearTimeout(timer);
          sub.remove();
          resolve(true);
        }
      }, true);
    });
  }

  /**
   * Scan for a device advertising the NUS service.
   * Resolves with the Device when found, or null on timeout.
   */
  private scanForDevice(timeoutMs: number): Promise<Device | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const finish = (device: Device | null) => {
        if (resolved) return;
        resolved = true;
        this.getManager().stopDeviceScan();
        resolve(device);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      this.getManager().startDeviceScan(
        // No UUID filter — match by name in the callback instead.
        // The NUS service UUID is now in the scan response (not the primary ad),
        // so serviceUUIDs is empty on the first callback; name is reliable.
        null,
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            clearTimeout(timer);
            finish(null);
            return;
          }
          if (device) {
            const name = device.name ?? device.localName;
            if (name && isClusterDuckDevice(name)) {
              clearTimeout(timer);
              finish(device);
            }
          }
        },
      );
    });
  }
}

export const bleService = new BleService();
