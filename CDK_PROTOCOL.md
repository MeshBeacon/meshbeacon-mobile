# CDK Protocol & Integration Guide

Complete documentation for the CDK mobile app and its communication protocol
with an ESP32 device, covering both Android (USB serial) and iOS/Android
(Bluetooth LE) transports.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Wire Protocol](#2-wire-protocol)
   - [Frame Format](#21-frame-format)
   - [App → ESP32 Frames](#22-app--esp32-frames)
   - [ESP32 → App Frames](#23-esp32--app-frames)
3. [Android Transport — USB Serial](#3-android-transport--usb-serial)
4. [iOS & Android Transport — Bluetooth LE](#4-ios--android-transport--bluetooth-le)
5. [ESP32 Firmware Reference](#5-esp32-firmware-reference)
   - [USB Serial (Arduino)](#51-usb-serial-arduino)
   - [BLE UART / NUS (Arduino + NimBLE)](#52-ble-uart--nus-arduino--nimble)
   - [Combined Firmware (USB + BLE)](#53-combined-firmware-usb--ble)
6. [Mobile App Code Map](#6-mobile-app-code-map)
7. [Permissions & Build Config](#7-permissions--build-config)
8. [Connection State Management](#8-connection-state-management)
9. [Message Persistence](#9-message-persistence)
10. [Notifications](#10-notifications)
11. [Device Button SOS](#11-device-button-sos)
12. [Transport Selection & Startup Flow](#12-transport-selection--startup-flow)
13. [BLE Device Discovery](#13-ble-device-discovery)

---

## 1. Architecture Overview

```
┌─────────────────────────────┐
│       CDK Mobile App      │
│  (Expo / React Native)       │
│                              │
│  ┌────────────┐              │
│  │ ITransport │ (interface)  │
│  └─────┬──────┘              │
│        │                     │
│   ┌────┴────┐ ┌───────────┐  │
│   │ USB     │ │ BLE       │  │
│   │ Serial  │ │ (NUS)     │  │
│   │(Android)│ │(iOS+Andr) │  │
│   └────┬────┘ └─────┬─────┘  │
└────────│─────────────│────────┘
         │             │
    USB-C cable    Bluetooth 4.2+
         │             │
┌────────┴─────────────┴────────┐
│            ESP32               │
│  Reads/writes CDK: frames   │
└───────────────────────────────┘
```

**Platform selection** is automatic via `services/index.ts`:

| Platform           | Transport    | Library                                   |
| ------------------ | ------------ | ----------------------------------------- |
| Android            | USB Serial   | `react-native-usb-serialport-for-android` |
| iOS                | Bluetooth LE | `react-native-ble-plx`                    |
| Android (optional) | Bluetooth LE | `react-native-ble-plx`                    |

---

## 2. Wire Protocol

### 2.1 Frame Format

Every frame is a **newline-terminated ASCII string**:

```
CDK:<TYPE>,<KEY>:<VALUE>,<KEY>:<VALUE>\n
```

Rules:

- All frames begin with the literal prefix `CDK:` — the ESP32 uses this to
  reject noise and data from other sources.
- Fields are separated by commas.
- Each field is a `KEY:VALUE` pair. Keys are uppercase.
- The frame ends with a Unix newline `\n` (`0x0A`). CRLF (`\r\n`) is also
  accepted by the app parser.
- **Maximum frame size is 256 bytes** including the trailing `\n`. Frames
  longer than this are rejected by the app parser and should never be emitted
  by the firmware.
- Commas inside `TEXT` values are replaced with semicolons `;` by the app
  before sending, so the CSV structure is never broken.
- Encoding over USB serial: plain ASCII sent as hex pairs
  (`53544954434...`).
- Encoding over BLE: plain ASCII, base64-encoded per the BLE-PLX library
  requirement.

---

### 2.2 App → ESP32 Frames

These frames are **sent by the mobile app** and received by the ESP32.

#### SOS Alert

Sent when the user taps the big red SOS button.

```
CDK:SOS,LAT:<latitude>,LNG:<longitude>\n
```

| Field | Type                          | Example      | Notes                       |
| ----- | ----------------------------- | ------------ | --------------------------- |
| `LAT` | float string (6 dp) or `none` | `3.140000`   | `none` when GPS unavailable |
| `LNG` | float string (6 dp) or `none` | `101.686000` | `none` when GPS unavailable |

Examples:

```
CDK:SOS,LAT:3.140000,LNG:101.686000\n
CDK:SOS,LAT:none,LNG:none\n
```

#### Text Message

Sent when the user composes and sends a message.

```
CDK:MSG,URGENCY:<level>,LAT:<latitude>,LNG:<longitude>,TEXT:<text>\n
```

| Field     | Values                        | Notes                    |
| --------- | ----------------------------- | ------------------------ |
| `URGENCY` | `low` / `medium` / `critical` |                          |
| `LAT`     | float string or `none`        |                          |
| `LNG`     | float string or `none`        |                          |
| `TEXT`    | ASCII string                  | Commas replaced with `;` |

Examples:

```
CDK:MSG,URGENCY:critical,LAT:3.140000,LNG:101.686000,TEXT:Need medical help immediately\n
CDK:MSG,URGENCY:low,LAT:none,LNG:none,TEXT:All clear; heading back to base\n
```

#### PING — Device ID Request

Sent by the app shortly after connecting to prompt the ESP32 to re-broadcast its
device ID. This is necessary over BLE where the `onConnect` callback fires before
the app's RX subscription is confirmed.

```
CDK:PING\n
```

No fields. The ESP32 responds with a `CDK:ID` frame immediately.

---

### 2.3 ESP32 → App Frames

These frames are **sent by the ESP32** and received by the mobile app. They
update the live Device Info card on the home screen.

#### Battery Level ← **displayed on home screen**

```
CDK:BATT,LEVEL:<percent>\n
```

| Field   | Type    | Range | Notes                   |
| ------- | ------- | ----- | ----------------------- |
| `LEVEL` | integer | 0–100 | Whole number percentage |

Example:

```
CDK:BATT,LEVEL:72\n
```

The app shows a colour-coded progress bar:

- Green when > 20 %
- Red when ≤ 20 %

Recommended: send once on connect, then every 60 seconds or when the level
changes by more than 2 %.

---

#### Device ID ← **displayed on home screen**

```
CDK:ID,VALUE:<identifier>\n
```

| Field   | Type         | Notes                                          |
| ------- | ------------ | ---------------------------------------------- |
| `VALUE` | ASCII string | Any identifier you set in firmware (no commas) |

Examples:

```
CDK:ID,VALUE:DUCK-01\n
CDK:ID,VALUE:NODE-ALPHA\n
CDK:ID,VALUE:ESP32-ABF3\n
```

Recommended: send this once immediately after the connection is established
(e.g., in `setup()` for serial, or in the BLE connect callback).

---

#### Message Acknowledgement _(optional)_

```
CDK:ACK,ID:<message-id>\n
```

| Field | Type   | Notes                                                  |
| ----- | ------ | ------------------------------------------------------ |
| `ID`  | string | Echoes back an ID the app previously sent (future use) |

Example:

```
CDK:ACK,ID:3\n
```

---

#### Status / Telemetry _(optional)_

Arbitrary key-value pairs for any sensor data:

```
CDK:STATUS,<KEY>:<VALUE>,<KEY>:<VALUE>,...\n
```

Examples:

```
CDK:STATUS,RSSI:-45,TEMP:38\n
CDK:STATUS,PEERS:3,UPTIME:3600\n
```

All key/value pairs are stored in `statusFields` in the `useEsp32Data` hook and
are available to any screen.

---

#### Error _(optional)_

```
CDK:ERR,MSG:<description>\n
```

Example:

```
CDK:ERR,MSG:queue full\n
CDK:ERR,MSG:GPS timeout\n
```

---

#### Inbound LoRa Text Message

Sent by the ESP32 when it receives a text message relayed over the LoRa mesh
(e.g. from another Duck). The app displays these on the home screen.

```
CDK:MSG,TEXT:<message-text>\n
```

Example:

```
CDK:MSG,TEXT:Need assistance at sector 4\n
```

`TEXT` is a plain ASCII string with no embedded commas or newlines. The whole
frame must not exceed 256 bytes including the trailing `\n`, which limits
`TEXT` to at most 244 characters (`CDK:MSG,TEXT:` is 13 chars + `\n`).

> **Note on naming:** `CDK:MSG` is also the frame type the app sends _to_ the
> ESP32 (§2.2) but with different fields (`URGENCY`, `LAT`, `LNG`, `TEXT`).
> The two uses never collide because the ESP32 firmware only ever _receives_
> that variant and only ever _sends_ the `TEXT`-only variant.

---

#### Device Button SOS ← **triggers local notification**

Sent by the ESP32 when the **hardware SOS button** is pressed (distinct from an
app-originated SOS). The app displays a local notification and logs the event
in `deviceSosAlerts`.

```
CDK:SOS,SRC:DEVICE,ID:<deviceId>,LAT:<latitude>,LNG:<longitude>\n
```

| Field | Type   | Example    | Notes                                                                            |
| ----- | ------ | ---------- | -------------------------------------------------------------------------------- |
| `SRC` | string | `DEVICE`   | Always `DEVICE` for hardware-button origin; app SOS frames never have this field |
| `ID`  | string | `ZAIHAN12` | Duck name / device identifier                                                    |
| `LAT` | string | `none`     | GPS not typically available at firmware level; usually `none`                    |
| `LNG` | string | `none`     | same as above                                                                    |

Example:

```
CDK:SOS,SRC:DEVICE,ID:ZAIHAN12,LAT:none,LNG:none\n
```

The corresponding LoRa payload broadcast by the firmware:

```
SOS,SRC:DEVICE,ID:ZAIHAN12
```

> **Disambiguation:** App-originated SOS frames sent _to_ the ESP32 (§2.2) do
> not have a `SRC` field. The `SRC:DEVICE` field is exclusively present in
> firmware-originated frames sent _to_ the app.

---

## 3. Android Transport — USB Serial

**Physical connection:** USB-C cable from phone to ESP32 (or CP2102/CH340 USB
adapter).

**Settings:** 115200 baud, 8 data bits, no parity, 1 stop bit (8N1).

**Flow:**

1. App calls `transport.connect()`.
2. `UsbSerialManager.list()` finds the first USB device.
3. System permission dialog is shown — user taps **Allow**.
4. Port is opened; the app subscribes to `onReceived` for incoming hex data.
5. Outbound frames are hex-encoded and sent via `port.send(hexString)`.
6. Inbound hex is decoded to ASCII, buffered line-by-line, then parsed.

**No Bluetooth needed on Android** when using the cable — this is the simplest
and most reliable transport.

### Disconnect Detection

`react-native-usb-serialport-for-android` does not fire a disconnect event when
the cable is unplugged. Instead, `services/serial.ts` runs a **2-second poll**
using `UsbSerialManager.list()`. When the device disappears from the list the
service calls its own `disconnect()` method, which:

1. Clears the port reference and stops the poll.
2. Emits `status = "disconnected"` to all listeners.
3. `SerialContext` propagates the status change; `useEsp32Data` receives a
   `__RESET__` synthetic action that clears `deviceId`, `battery`, and all
   other state so the UI doesn't show stale data.

Additionally, any `port.send()` failure inside `sendRaw()` triggers an
immediate `disconnect()` call — this catches mid-transfer cable pulls that the
poll would otherwise miss for up to 2 s.

```typescript
// services/serial.ts (simplified)
private startDisconnectPoll() {
  this._pollTimer = setInterval(async () => {
    const devices = await UsbSerialManager.list();
    const found = devices.some(d => d.deviceId === this._deviceId);
    if (!found) this.disconnect();
  }, 2000);
}
```

---

## 4. iOS & Android Transport — Bluetooth LE

Uses the **Nordic UART Service (NUS)** — a widely supported BLE UART profile
that ArduinoBLE, NimBLE-Arduino, and ESP-IDF all implement.

### NUS UUIDs

| Role                                               | UUID                                   |
| -------------------------------------------------- | -------------------------------------- |
| **Service**                                        | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| **RX Characteristic** (phone writes → ESP32 reads) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| **TX Characteristic** (ESP32 writes → phone reads) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

### Connection flow

1. App calls `transport.connect()` (or `connectToBleDevice(deviceId)` for a
   specific target).
2. Bluetooth adapter readiness is checked (up to 5 s).
3. App scans using a **null UUID filter** (see §13 below). Devices are filtered
   by name in JavaScript: names matching `DUCK`, `MAMA`, `PAPA`, `ZAIHAN`, or
   `CDK` are accepted. A specific previously scanned `deviceId` bypasses the
   scan entirely.  
   Scan timeout: **15 seconds**.
4. First matching device is connected; services/characteristics are discovered.
5. MTU is negotiated to 512 bytes (falls back gracefully if unsupported).
6. App subscribes to the **TX characteristic** (notify) to receive frames.
7. Outbound frames are written to the **RX characteristic** (write-with-response)
   as base64.
8. After **300 ms** the app sends `CDK:PING\n` to prompt the device for its ID
   (see below). This provides reliable ID delivery independent of the firmware's
   `onConnect` timing.

### Device ID over BLE — PING mechanism

BLE `onConnect` callbacks on the firmware side fire before the phone has
confirmed its TX subscription. Frames sent in the first ~200 ms are often
dropped. To work around this, the app sends `CDK:PING` 300 ms after the
connection is fully established. The firmware responds immediately with
`CDK:ID,VALUE:<name>`.

The firmware optionally also sends `CDK:ID` in its `onConnect` callback
(with a short delay as a fallback), but the PING path is the primary
reliable mechanism.

### BLE Advertising Power Management

When an Android phone connects via USB serial, BLE scanning and advertising are
unnecessary and waste power. The firmware tracks the last time a USB byte was
received (`lastUsbRxMs`) and:

- Stops BLE advertising when USB traffic is active (`bleAdvertising = false`).
- Restarts advertising after **30 seconds** of USB idle time
  (`USB_IDLE_TIMEOUT_MS`).
- The BLE `onDisconnect` callback checks USB state before restarting advertising:
  if USB is currently active it skips the restart.

This means a phone connected via cable will see BLE scanning as unavailable
from nearby devices — intentional, since the device is already connected.

### iOS notes

- iOS 13+ does not require runtime permissions for BLE centrals.
- The `NSBluetoothAlwaysUsageDescription` key is set in `app.json` — Expo adds
  it to `Info.plist` automatically during the build.
- The app can only connect to devices advertising the NUS service UUID; the
  ESP32 must advertise it explicitly (see firmware section below).

### Android BLE notes

- Android 12+ requires `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` runtime
  permissions. The app requests them automatically before scanning.
- On Android you can use **either** USB serial (cable) or BLE. A startup prompt
  (`ConnectPromptSheet`) is shown on first launch asking the user which transport
  to use.
- The default mode stored by `SerialContext` is `"usb"` on Android.
- To switch to BLE after initial setup, use the toggle in the
  `SerialStatusBanner` or tap "Connect via Bluetooth" in the startup prompt.
- When BLE is selected on Android, the `BleScanSheet` bottom sheet lets the user
  **pick a specific device** from a live scan list showing RSSI signal strength
  (see §13).

---

## 5. ESP32 Firmware Reference

### 5.1 USB Serial (Arduino)

Minimal Arduino sketch for USB serial communication. Works with any ESP32 board
that appears as a CDC USB device (most do out of the box).

```cpp
// ─────────────────────────────────────────────────────────────────
// CDK ESP32 — USB Serial transport
// Baud: 115200  |  8N1
// ─────────────────────────────────────────────────────────────────

#include <MamaDuck.h>

MamaDuck duck;

#define DEVICE_ID   "DUCK-01"    // ← set your unique ID here
#define BATT_PIN    34           // ADC pin for battery voltage divider

// ── LoRa receive callback ───────────────────────────────────────────
// Called by the ClusterDuck runtime whenever a LoRa packet arrives
// from the mesh. Forwards the payload to the phone as CDK:MSG.
void receivedLoRaMsg(std::vector<byte> message) {
  String text;
  for (byte b : message) text += (char)b;
  // Truncate to fit within the 256-byte frame limit
  // "CDK:MSG,TEXT:" = 13 chars, "\n" = 1 char → max text = 242 chars
  if (text.length() > 242) text = text.substring(0, 242);
  Serial.println("CDK:MSG,TEXT:" + text);
}

// ── Setup ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);  // wait for host to enumerate

  duck.setReceiveCallback(receivedLoRaMsg);

  // Announce device ID immediately so the app picks it up
  Serial.println("CDK:ID,VALUE:" DEVICE_ID);

  // Send initial battery reading
  sendBattery();
}

// ── Main loop ───────────────────────────────────────────────────────
static unsigned long lastBattMs = 0;
static String inBuf = "";

void loop() {
  // ── Read incoming frames from the app ──────────────────────────
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      handleFrame(inBuf);
      inBuf = "";
    } else if (c != '\r') {
      inBuf += c;
    }
  }

  // ── Process ClusterDuck LoRa events ────────────────────────────
  duck.run();

  // ── Send battery every 60 s ────────────────────────────────────
  if (millis() - lastBattMs >= 60000UL) {
    sendBattery();
    lastBattMs = millis();
  }
}

// ── Frame dispatcher ────────────────────────────────────────────────
void handleFrame(const String& line) {
  if (!line.startsWith("CDK:")) return;  // ignore noise

  String body = line.substring(4);  // strip "CDK:"
  int comma = body.indexOf(',');
  String type = (comma == -1) ? body : body.substring(0, comma);

  if (type == "SOS") {
    handleSOS(body);
  } else if (type == "MSG") {
    handleMsg(body);
  }
  // Add more types here as needed
}

void handleSOS(const String& body) {
  // Parse LAT and LNG
  String lat = extractField(body, "LAT");
  String lng = extractField(body, "LNG");

  Serial.print("[SOS] LAT="); Serial.print(lat);
  Serial.print(" LNG="); Serial.println(lng);

  String message = "SOS,LAT:" + lat + ",LNG:" + lng;  // no \n — sendData handles its own framing
  int failure = duck.sendData(topics::status, message);
  if (!failure) {
    Serial.println("[MAMA] send ok.");
  } else {
    Serial.println("[MAMA] send failed.");
  }

  // Acknowledge receipt
  Serial.println("CDK:ACK,ID:SOS");
}

void handleMsg(const String& body) {
  String urgency = extractField(body, "URGENCY");
  String lat     = extractField(body, "LAT");
  String lng     = extractField(body, "LNG");
  String text    = extractField(body, "TEXT");

  Serial.print("[MSG] urgency="); Serial.print(urgency);
  Serial.print(" text="); Serial.println(text);

  String message = "MSG,URGENCY:" + urgency + ",TEXT:" + text;  // no \n
  int failure = duck.sendData(topics::status, message);
  if (!failure) {
    Serial.println("[MAMA] send ok.");
  } else {
    Serial.println("[MAMA] send failed.");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract VALUE from "TYPE,KEY1:VAL1,KEY2:VAL2,..." */
String extractField(const String& body, const String& key) {
  String search = key + ":";
  int idx = body.indexOf(search);
  if (idx == -1) return "";
  int start = idx + search.length();
  int end = body.indexOf(',', start);
  return (end == -1) ? body.substring(start) : body.substring(start, end);
}

/** Read battery ADC and send a BATT frame.
 *  Assumes a simple resistor divider: Vbat → 100k → ADC pin → 100k → GND
 *  (gives 0–2.1 V range for a 1S LiPo 3.0–4.2 V). Adjust for your circuit. */
void sendBattery() {
  int raw = analogRead(BATT_PIN);           // 0–4095 on ESP32
  float vPin = raw * (3.3f / 4095.0f);     // voltage at ADC pin
  float vBat = vPin * 2.0f;                // undo divider (100k:100k)
  // Map 3.0 V (0%) to 4.2 V (100%)
  int pct = (int)constrain((vBat - 3.0f) / (4.2f - 3.0f) * 100.0f, 0, 100);
  Serial.println("CDK:BATT,LEVEL:" + String(pct));
}
```

---

### 5.2 BLE UART / NUS (Arduino + NimBLE)

> **Library:** [NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino)  
> Install via Arduino Library Manager: **NimBLE-Arduino**
>
> ⚠️ **Version note:** NimBLE-Arduino v2.x changed the callback signatures.
> The sketch below targets **v2.x** (recommended). If you are on v1.x, remove
> the `NimBLEConnInfo&` and `int reason` parameters from each callback.

```cpp
// ─────────────────────────────────────────────────────────────────
// CDK ESP32 — BLE NUS transport
// Works with iOS and Android via react-native-ble-plx
// ─────────────────────────────────────────────────────────────────

#include <NimBLEDevice.h>

#define DEVICE_ID   "DUCK-01"    // ← set your unique ID here
#define BATT_PIN    34

// Nordic UART Service UUIDs
#define NUS_SERVICE "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_CHAR "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // app writes here
#define NUS_TX_CHAR "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // ESP32 writes here

static NimBLECharacteristic* pTxChar = nullptr;
static bool deviceConnected = false;
static String inBuf = "";
static unsigned long lastBattMs = 0;

// ── LoRa receive callback ──────────────────────────────────────────
void receivedLoRaMsg(std::vector<byte> message) {
  String text;
  for (byte b : message) text += (char)b;
  if (text.length() > 242) text = text.substring(0, 242);
  sendFrame("CDK:MSG,TEXT:" + text);
}

// ── Send a CDK frame over BLE (notify the connected client) ─────
void sendFrame(const String& frame) {
  if (!deviceConnected || !pTxChar) return;
  String payload = frame;
  if (!payload.endsWith("\n")) payload += "\n";
  pTxChar->setValue(payload.c_str());
  pTxChar->notify();
}

void sendBattery() {
  int raw = analogRead(BATT_PIN);
  float vPin = raw * (3.3f / 4095.0f);
  float vBat = vPin * 2.0f;
  int pct = (int)constrain((vBat - 3.0f) / 1.2f * 100.0f, 0, 100);
  sendFrame("CDK:BATT,LEVEL:" + String(pct));
}

// ── BLE callbacks ────────────────────────────────────────────────────

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    deviceConnected = true;
    // Announce ID and battery as soon as the phone connects
    sendFrame("CDK:ID,VALUE:" DEVICE_ID);
    delay(20);  // small gap so frames don't merge in the buffer
    sendBattery();
  }
  void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
    deviceConnected = false;
    inBuf = "";
    // Restart advertising so the phone can reconnect
    NimBLEDevice::startAdvertising();
  }
};

/** Called whenever the app writes to the RX characteristic. */
class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
    std::string val = pChar->getValue();
    for (char c : val) {
      if (c == '\n') {
        handleFrame(String(inBuf));
        inBuf = "";
      } else if (c != '\r') {
        inBuf += c;
      }
    }
  }
};

// ── Frame dispatcher ────────────────────────────────────────────────
void handleFrame(const String& line) {
  if (!line.startsWith("CDK:")) return;

  String body = line.substring(4);
  int comma = body.indexOf(',');
  String type = (comma == -1) ? body : body.substring(0, comma);

  if (type == "SOS") {
    handleSOS(body);
  } else if (type == "MSG") {
    handleMsg(body);
  }
}

void handleSOS(const String& body) {
  String lat = extractField(body, "LAT");
  String lng = extractField(body, "LNG");
  Serial.print("[SOS] LAT="); Serial.print(lat);
  Serial.print(" LNG="); Serial.println(lng);

  String message = "SOS,LAT:" + lat + ",LNG:" + lng;  // no \n — sendData handles its own framing
  int failure = duck.sendData(topics::status, message);
  if (!failure) {
    Serial.println("[MAMA] send ok.");
  } else {
    Serial.println("[MAMA] send failed.");
  }
  sendFrame("CDK:ACK,ID:SOS");
}

void handleMsg(const String& body) {
  String urgency = extractField(body, "URGENCY");
  String text    = extractField(body, "TEXT");
  Serial.print("[MSG] "); Serial.print(urgency);
  Serial.print(" — "); Serial.println(text);

  String message = "MSG,URGENCY:" + urgency + ",TEXT:" + text;  // no \n
  int failure = duck.sendData(topics::status, message);
  if (!failure) {
    Serial.println("[MAMA] send ok.");
  } else {
    Serial.println("[MAMA] send failed.");
  }
}

String extractField(const String& body, const String& key) {
  String search = key + ":";
  int idx = body.indexOf(search);
  if (idx == -1) return "";
  int start = idx + search.length();
  int end = body.indexOf(',', start);
  return (end == -1) ? body.substring(start) : body.substring(start, end);
}

// ── Setup ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  NimBLEDevice::init(DEVICE_ID);          // BLE name = device ID
  NimBLEDevice::setPower(ESP_PWR_LVL_P9); // max TX power

  NimBLEServer* pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  NimBLEService* pService = pServer->createService(NUS_SERVICE);

  // TX char — ESP32 notifies app
  pTxChar = pService->createCharacteristic(
    NUS_TX_CHAR,
    NIMBLE_PROPERTY::NOTIFY
  );

  // RX char — app writes to ESP32
  NimBLECharacteristic* pRxChar = pService->createCharacteristic(
    NUS_RX_CHAR,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  pRxChar->setCallbacks(new RxCallbacks());

  pService->start();

  // Advertise the NUS service UUID so the app's scanner can find the device
  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
  pAdv->addServiceUUID(NUS_SERVICE);
  NimBLEDevice::startAdvertising();

  duck.setReceiveCallback(receivedLoRaMsg);

  Serial.println("CDK BLE ready — advertising as: " DEVICE_ID);
}

// ── Loop ───────────────────────────────────────────────────────────
void loop() {
  if (deviceConnected && millis() - lastBattMs >= 60000UL) {
    sendBattery();
    lastBattMs = millis();
  }
  duck.run();
  delay(10);
}
```

---

### 5.3 Combined Firmware (USB + BLE)

If you want the ESP32 to talk to Android over USB **and** to iOS over BLE
simultaneously, use the combined sketch below. It merges both transports: it
reads from `Serial` (USB) and from the BLE RX characteristic, and broadcasts
outbound frames on both channels at once.

```cpp
// ─────────────────────────────────────────────────────────────────
// CDK ESP32 — Combined USB Serial + BLE NUS transport
// Android connects via USB cable; iOS connects via Bluetooth
// ─────────────────────────────────────────────────────────────────

#include <NimBLEDevice.h>
#include <MamaDuck.h>

MamaDuck duck;

#define DEVICE_ID   "DUCK-01"
#define BATT_PIN    34

#define NUS_SERVICE "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_CHAR "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_CHAR "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

static NimBLECharacteristic* pTxChar = nullptr;
static bool bleConnected = false;
static String bleInBuf = "";
static String usbInBuf = "";
static unsigned long lastBattMs = 0;

// ── LoRa receive callback ──────────────────────────────────────────
void receivedLoRaMsg(std::vector<byte> message) {
  String text;
  for (byte b : message) text += (char)b;
  if (text.length() > 242) text = text.substring(0, 242);
  broadcast("CDK:MSG,TEXT:" + text);
}

// ── Broadcast on all active channels ────────────────────────────────
void broadcast(const String& frame) {
  String payload = frame.endsWith("\n") ? frame : frame + "\n";
  // USB Serial
  Serial.print(payload);
  // BLE — only if a phone is connected
  if (bleConnected && pTxChar) {
    pTxChar->setValue(payload.c_str());
    pTxChar->notify();
  }
}

void sendBattery() {
  int raw = analogRead(BATT_PIN);
  float vPin = raw * (3.3f / 4095.0f);
  float vBat = vPin * 2.0f;
  int pct = (int)constrain((vBat - 3.0f) / 1.2f * 100.0f, 0, 100);
  broadcast("CDK:BATT,LEVEL:" + String(pct));
}

// ── Frame dispatcher ─────────────────────────────────────────────────
void handleFrame(const String& line) {
  if (!line.startsWith("CDK:")) return;
  String body = line.substring(4);
  int comma = body.indexOf(',');
  String type = (comma == -1) ? body : body.substring(0, comma);

  if (type == "SOS") {
    String lat = extractField(body, "LAT");
    String lng = extractField(body, "LNG");
    Serial.print("[SOS] "); Serial.print(lat); Serial.print(","); Serial.println(lng);

    String message = "SOS,LAT:" + lat + ",LNG:" + lng;  // no \n — sendData handles its own framing
    int failure = duck.sendData(topics::status, message);
    if (!failure) {
      Serial.println("[MAMA] send ok.");
    } else {
      Serial.println("[MAMA] send failed.");
    }
    broadcast("CDK:ACK,ID:SOS");
  } else if (type == "MSG") {
    String urgency = extractField(body, "URGENCY");
    String text    = extractField(body, "TEXT");
    Serial.print("[MSG] "); Serial.print(urgency); Serial.print(" "); Serial.println(text);

    String message = "MSG,URGENCY:" + urgency + ",TEXT:" + text;  // no \n
    int failure = duck.sendData(topics::status, message);
    if (!failure) {
      Serial.println("[MAMA] send ok.");
    } else {
      Serial.println("[MAMA] send failed.");
    }
  }
}

String extractField(const String& body, const String& key) {
  String search = key + ":";
  int idx = body.indexOf(search);
  if (idx == -1) return "";
  int start = idx + search.length();
  int end = body.indexOf(',', start);
  return (end == -1) ? body.substring(start) : body.substring(start, end);
}

// ── BLE callbacks ─────────────────────────────────────────────────────
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo& connInfo) override {
    bleConnected = true;
    delay(50);
    broadcast("CDK:ID,VALUE:" DEVICE_ID);
    delay(20);
    sendBattery();
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo& connInfo, int reason) override {
    bleConnected = false;
    bleInBuf = "";
    NimBLEDevice::startAdvertising();
  }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
    std::string val = pChar->getValue();
    for (char c : val) {
      if (c == '\n') { handleFrame(bleInBuf); bleInBuf = ""; }
      else if (c != '\r') bleInBuf += c;
    }
  }
};

// ── Setup ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // Send ID + battery over USB immediately
  Serial.println("CDK:ID,VALUE:" DEVICE_ID);
  sendBattery();

  // BLE init
  NimBLEDevice::init(DEVICE_ID);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEServer* pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  NimBLEService* pSvc = pServer->createService(NUS_SERVICE);
  pTxChar = pSvc->createCharacteristic(NUS_TX_CHAR, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* pRxChar = pSvc->createCharacteristic(
    NUS_RX_CHAR, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  pRxChar->setCallbacks(new RxCallbacks());
  pSvc->start();
  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
  pAdv->addServiceUUID(NUS_SERVICE);
  NimBLEDevice::startAdvertising();

  duck.setReceiveCallback(receivedLoRaMsg);
}

// ── Loop ──────────────────────────────────────────────────────────────
void loop() {
  // USB incoming
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { handleFrame(usbInBuf); usbInBuf = ""; }
    else if (c != '\r') usbInBuf += c;
  }
  // Process ClusterDuck LoRa events
  duck.run();
  // Periodic battery
  if (millis() - lastBattMs >= 60000UL) {
    sendBattery();
    lastBattMs = millis();
  }
  delay(5);
}
```

---

## 6. Mobile App Code Map

| File                                  | Purpose                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/transport.ts`               | `ITransport` interface, all frame types (incl. `DeviceSosFrame`), `parseIncomingLine()`, `LineBuffer`                                                                          |
| `services/serial.ts`                  | USB serial implementation of `ITransport` (Android); 2-s disconnect poll; auto-disconnect on send failure                                                                      |
| `services/ble.ts`                     | BLE NUS implementation of `ITransport` (iOS + Android); `scanDevices()`; `connect(targetDeviceId?)`; PING after connect; name-based scan filter                                |
| `services/index.ts`                   | Picks the right transport for the current platform; `defaultTransportMode`; exports `bleService` for direct access                                                             |
| `contexts/serial-context.tsx`         | React context wrapping the active transport; provides `useSerial()` with `status`, `connect`, `disconnect`, `sendSOS`, `sendMessage`, `setTransportMode`, `connectToBleDevice` |
| `components/serial-status-banner.tsx` | Colour-coded connection banner on all action screens; USB/BLE toggle; disconnect button; BLE "Connect" opens `BleScanSheet`                                                    |
| `components/connect-prompt-sheet.tsx` | Android-only startup bottom sheet asking user to choose USB or BLE transport before first connection                                                                           |
| `components/ble-device-picker.tsx`    | Live BLE scan list showing nearby ClusterDuck devices with RSSI signal strength; tap to connect                                                                                |
| `hooks/use-location.ts`               | Requests GPS permission, watches position; returns `GpsState`                                                                                                                  |
| `hooks/use-esp32-data.ts`             | Subscribes to `transport.onFrameReceived()`; reducer with `__RESET__` on disconnect; returns `{ battery, deviceId, deviceSosAlerts, lastAckId, statusFields, lastError }`      |
| `hooks/use-message-store.ts`          | Persistent message storage via `expo-file-system`; JSON file at `documentDirectory/cdk-messages.json`; max 200 messages                                                        |
| `hooks/use-message-notifications.ts`  | Local push notifications via `expo-notifications`; `notifyNewMessage(text)` and `notifyDeviceSOS(deviceId)`                                                                    |
| `app/(tabs)/index.tsx`                | Home screen — SOS button, GPS card, Device Info card (ID + battery), device SOS alert history                                                                                  |
| `app/(tabs)/messages.tsx`             | Persistent message history list (sent + received)                                                                                                                              |
| `app/(tabs)/settings.tsx`             | Emergency contacts CRUD + personal Medical ID editing                                                                                                                          |
| `app/new-message.tsx`                 | Compose and send a text message with urgency level + optional GPS                                                                                                              |
| `app/_layout.tsx`                     | Root stack; wraps app in `SerialProvider`; renders `ConnectPromptSheet`                                                                                                        |
| `app.json`                            | Expo config; declares plugins for `react-native-ble-plx`, `expo-location`, `expo-notifications`, `expo-file-system`; USB + Bluetooth permissions                               |

### Adding a new incoming frame type

1. Add the type to `services/transport.ts`:
   ```ts
   export type TempFrame = { type: "TEMP"; celsius: number };
   export type IncomingFrame = ... | TempFrame | ...;
   ```
2. Add the parser case in `parseIncomingLine()`:
   ```ts
   case "TEMP":
     return { type: "TEMP", celsius: parseFloat(fields["C"] ?? "0") };
   ```
3. Handle it in `hooks/use-esp32-data.ts`:
   ```ts
   case "TEMP":
     return { ...state, temperature: (frame as TempFrame).celsius, lastFrame: frame };
   ```
4. Send it from the ESP32:
   ```
   CDK:TEMP,C:36.7\n
   ```

---

## 7. Permissions & Build Config

### iOS (`app.json` / `Info.plist`)

| Permission         | Key                                   | Set by                                      |
| ------------------ | ------------------------------------- | ------------------------------------------- |
| Bluetooth          | `NSBluetoothAlwaysUsageDescription`   | `react-native-ble-plx` plugin in `app.json` |
| Location (for GPS) | `NSLocationWhenInUseUsageDescription` | `expo-location` plugin in `app.json`        |

### Android (`AndroidManifest.xml`)

| Permission               | When requested                   | Set by                                    |
| ------------------------ | -------------------------------- | ----------------------------------------- |
| `BLUETOOTH_SCAN`         | BLE connect (Android 12+)        | `react-native-ble-plx` plugin             |
| `BLUETOOTH_CONNECT`      | BLE connect (Android 12+)        | `react-native-ble-plx` plugin             |
| `USB_PERMISSION`         | USB serial connect               | `react-native-usb-serialport-for-android` |
| `ACCESS_FINE_LOCATION`   | GPS                              | `expo-location` plugin                    |
| `ACCESS_COARSE_LOCATION` | GPS                              | `expo-location` plugin                    |
| `POST_NOTIFICATIONS`     | Push notifications (Android 13+) | `expo-notifications` plugin               |

All permissions are declared automatically by their respective Expo config
plugins — no manual `AndroidManifest.xml` editing required.

### Native Packages Reference

| Package                                   | Transport / Feature              | Platform      |
| ----------------------------------------- | -------------------------------- | ------------- |
| `react-native-usb-serialport-for-android` | USB Serial transport             | Android only  |
| `react-native-ble-plx`                    | BLE NUS transport                | iOS + Android |
| `expo-location`                           | GPS coordinates for SOS/MSG      | iOS + Android |
| `expo-notifications`                      | Local push notifications         | iOS + Android |
| `expo-file-system`                        | Message persistence to JSON file | iOS + Android |

### Building

```bash
# Development (Expo Go does not support native modules — use a dev build)
npx expo run:android
npx expo run:ios

# Production
eas build --platform android
eas build --platform ios
```

> **Note:** `react-native-usb-serialport-for-android` and `react-native-ble-plx`
> are both native modules. They require a **custom development build** (or
> production build) — they will **not** work inside Expo Go.

---

## 8. Connection State Management

### Status Lifecycle

```
disconnected ──connect()──▶ connecting ──success──▶ connected
     ▲                                                   │
     └────────────────disconnect()──────────────────────┘
```

`SerialContext` holds the canonical `status: "disconnected" | "connecting" | "connected"`.
All screens read it via `useSerial().status`.

### State Reset on Disconnect

When `status` transitions to `"disconnected"`, `useEsp32Data` dispatches a
synthetic `__RESET__` action to its reducer, which clears all device state:

```typescript
case "__RESET__":
  return { ...initialState };
```

This prevents stale data (old device ID, battery level, etc.) being displayed
after reconnect to a different device.

### Recovery After Reconnect

When the ESP32 reconnects (USB cable re-plugged, or BLE re-pair):

1. The app re-runs the normal connect flow.
2. On BLE: app sends `CDK:PING` 300 ms after connecting; firmware replies
   with `CDK:ID`.
3. On USB: firmware re-broadcasts `CDK:ID` at the top of `handleFrame()` on
   the very first incoming frame (so even a stale CDC enumeration recovers).

---

## 9. Message Persistence

Messages (both sent and received) are persisted across app restarts using
`expo-file-system`.

### Storage File

```
{EXPO_DOCUMENT_DIRECTORY}/cdk-messages.json
```

A JSON array of `StoredMessage` objects:

```typescript
interface StoredMessage {
  id: string; // UUID
  direction: "sent" | "received";
  text: string;
  urgency?: "low" | "medium" | "critical";
  timestamp: number; // Unix ms
  lat?: string;
  lng?: string;
}
```

### Limits

- Maximum **200 messages** stored. When the limit is reached, the oldest
  messages are dropped (FIFO).

### Implementation

`hooks/use-message-store.ts` exposes:

```typescript
const { messages, addMessage, clearMessages } = useMessageStore();
```

Messages are loaded asynchronously on first render. All mutations write through
to the JSON file synchronously using `FileSystem.writeAsStringAsync`.

---

## 10. Notifications

Local push notifications are delivered via `expo-notifications`. No external
push server is involved — all notifications are scheduled locally on the device.

### Notification Types

| Event                                    | Title                      | Body                                               |
| ---------------------------------------- | -------------------------- | -------------------------------------------------- |
| Incoming LoRa message (`CDK:MSG`)        | 📨 New ClusterDuck Message | The message text                                   |
| Device button SOS (`CDK:SOS,SRC:DEVICE`) | 🆘 SOS from Device         | `<deviceId> triggered an SOS via hardware button.` |

### Implementation

`hooks/use-message-notifications.ts` exposes:

```typescript
const { notifyNewMessage, notifyDeviceSOS } = useMessageNotifications();
```

`notifyNewMessage(text)` is called from `useEsp32Data` when a `CDK:MSG` frame
arrives with a `TEXT` field.

`notifyDeviceSOS(deviceId)` is called when a `CDK:SOS,SRC:DEVICE` frame
arrives.

### Permissions

- **Android 13+:** `POST_NOTIFICATIONS` runtime permission. The app requests
  this on first use.
- **iOS:** Standard notification permission prompt on first use.

Permissions are requested inside `useMessageNotifications` via
`Notifications.requestPermissionsAsync()`.

---

## 11. Device Button SOS

The physical hardware SOS button on the ESP32 board calls `sendEmergency()` in
the firmware. This is distinct from an app-originated SOS (§2.2).

### Firmware Behaviour

1. On button press, `sendEmergency()` broadcasts over LoRa:
   ```
   SOS,SRC:DEVICE,ID:ZAIHAN12
   ```
2. Simultaneously broadcasts over all connected channels (USB + BLE):
   ```
   CDK:SOS,SRC:DEVICE,ID:ZAIHAN12,LAT:none,LNG:none\n
   ```

### App Behaviour

`parseIncomingLine()` detects `type === "SOS"` and checks for `SRC:DEVICE`:

```typescript
case "SOS": {
  const src = fields["SRC"] ?? "APP";
  return {
    type: "SOS",
    source: src === "DEVICE" ? "DEVICE" : "APP",
    deviceId: fields["ID"] ?? "",
    lat: fields["LAT"] ?? "none",
    lng: fields["LNG"] ?? "none",
    receivedAt: Date.now(),
  } satisfies DeviceSosFrame;
}
```

`useEsp32Data` appends the frame to `deviceSosAlerts[]` and calls
`notifyDeviceSOS(deviceId)` to fire a local notification.

### LoRa Payload Design

The compact payload `SOS,SRC:DEVICE,ID:ZAIHAN12` is chosen to:

- Remain under the LoRa mesh packet size limit.
- Be parseable by other Ducks in the network without CDK-specific logic.
- Distinguish hardware-button SOS from app-originated SOS for analytics.

---

## 12. Transport Selection & Startup Flow

On Android, both USB and BLE transports are available. The user chooses via a
startup prompt.

### ConnectPromptSheet

A bottom sheet (`components/connect-prompt-sheet.tsx`) is rendered once inside
`app/_layout.tsx` (inside `SerialProvider`). It is only shown on Android.

**Flow:**

1. Sheet appears when the app launches on Android.
2. User taps **USB (Cable)** or **Bluetooth**.
3. `setTransportMode(mode)` stores the choice in `SerialContext`.
4. `connect()` is called immediately (for USB) or the BLE scan sheet opens.
5. Sheet dismisses.

### Mode Switching After Connect

The `SerialStatusBanner` provides a USB↔BLE toggle when **disconnected**. It
does not permit switching while connected (disconnect first).

### Default Mode

```typescript
// services/index.ts
export const defaultTransportMode = Platform.OS === "android" ? "usb" : "ble";
```

---

## 13. BLE Device Discovery

### Why UUID Filtering Fails

NimBLE-Arduino places the 128-bit NUS service UUID in the **scan response**
packet (a separate secondary advertisement). Android's BLE scan API filters on
the primary advertisement packet only, so UUID-filtered scans silently miss
NimBLE devices.

**Solution:** Scan with `null` UUID filter and apply name-based filtering in
JavaScript:

```typescript
// services/ble.ts
function isClusterDuckDevice(name: string | null): boolean {
  if (!name) return false;
  const n = name.toUpperCase();
  return ["DUCK", "MAMA", "PAPA", "ZAIHAN", "CDK"].some((k) => n.includes(k));
}

// scan call — null = no UUID filter
manager.startDeviceScan(null, null, (error, device) => {
  if (device && isClusterDuckDevice(device.name)) onFound(device);
});
```

### BleScanSheet

`components/ble-device-picker.tsx` renders a bottom sheet with a live scan
list. Each entry shows:

- Device name
- RSSI dBm value
- Signal strength label: Strong (> −60 dBm) / Good (> −75 dBm) / Weak (≤ −75 dBm)

Tapping an entry calls `connectToBleDevice(device.id)` on `SerialContext`,
which calls `bleService.connect(deviceId)` directly — bypassing the scan phase
since the target ID is already known.

### ScannedDevice Type

```typescript
// services/ble.ts
export interface ScannedDevice {
  id: string; // platform device ID (stable per-session)
  name: string; // BLE advertised name
  rssi: number; // dBm, negative
}
```

`scanDevices(onFound, timeoutMs)` starts a scan, calls `onFound` for each
matching device, stops after `timeoutMs` ms, and returns a stop function for
early cancellation.
