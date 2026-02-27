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

const SCAN_TIMEOUT_MS = 15_000;
const FRAME_SOURCE = "CDK";

/**
 * ClusterDuck device names follow patterns like:
 *   ZAIHAN12, DUCK-01, MAMA-03, PAPA-DUCK, etc.
 * We match any name that starts with a known prefix or contains "DUCK".
 */
function isClusterDuckDevice(name: string): boolean {
  const upper = name.toUpperCase();
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

/** Encode a UTF-8/ASCII string to base64 (BLE-PLX requires base64). */
function toBase64(str: string): string {
  // React Native bundles a global `btoa`; use it if available, fall back manually.
  if (typeof btoa !== "undefined")
    return btoa(unescape(encodeURIComponent(str)));
  // Manual fallback (pure-ASCII only)
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
        connectedDevice = await this.getManager().connectToDevice(
          targetDeviceId,
          { autoConnect: false },
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
          // BLE-PLX delivers base64—decode to string
          const decoded = atob(characteristic.value);
          for (const line of this.lineBuffer.append(decoded)) {
            this.dispatchFrame(line);
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
    console.log(
      "[BLE/sendMessage] location received:",
      opts.location ?? "none",
    );
    console.log("[BLE/sendMessage] frame to send:", frame);
    console.log(
      "[BLE/sendMessage] mtuPayload:",
      this.mtuPayload,
      "encodedLen:",
      Math.ceil((frame.length + 1) / 3) * 4,
    );
    await this.sendRaw(frame);
  }

  // ── Scan for devices ───────────────────────────────────────────────────────

  /**
   * Scan for nearby ClusterDuck devices advertising NUS.
   * Calls onFound for each new device discovered.
   * Returns a stop function — call it to end the scan early.
   */
  scanDevices(
    onFound: (d: ScannedDevice) => void,
    timeoutMs = SCAN_TIMEOUT_MS,
  ): () => void {
    const seen = new Set<string>();
    const mgr = this.getManager();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stateSub: { remove: () => void } | null = null;

    const startScan = () => {
      if (stopped) return;
      mgr.startDeviceScan(
        null, // no UUID filter — NimBLE puts 128-bit UUIDs in scan response, not ad packet
        { allowDuplicates: false },
        (err, device) => {
          if (err || !device) return;
          const name = device.name ?? device.localName;
          // Only show devices whose name looks like a ClusterDuck device
          if (!seen.has(device.id) && name && isClusterDuckDevice(name)) {
            seen.add(device.id);
            onFound({ id: device.id, name, rssi: device.rssi ?? -99 });
          }
        },
      );
      timer = setTimeout(() => mgr.stopDeviceScan(), timeoutMs);
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
      if (timer !== null) clearTimeout(timer);
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
        [NUS_SERVICE],
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            clearTimeout(timer);
            finish(null);
            return;
          }
          if (device) {
            clearTimeout(timer);
            finish(device);
          }
        },
      );
    });
  }
}

export const bleService = new BleService();
