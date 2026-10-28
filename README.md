# CDK Mobile (ClusterDuck Mobile)

CDK Mobile is an [Expo](https://expo.dev) / React Native companion app for the
[ClusterDuck Protocol](https://clusterduckprotocol.org) mesh network. It turns
a phone into the field interface for a **MamaDuck** node (ESP32 or ARM M4 v0+),
connected over USB serial (Android) or Bluetooth LE (iOS/Android), so responders and
civilians can communicate, locate each other, and reach an emergency operator
— even with **no cellular signal or internet connection**.

## Key Features

### 🆘 SOS & Emergency Command Center
- One-tap **SOS button** sends the user's GPS location (lat/lng, altitude,
  speed, heading) over the LoRa mesh to the operator panel
  **MeshBeacon Ops** web application running the Emergency Command Center.
- The connected duck's physical **hardware SOS button** is also recognized,
  with phone-GPS fallback when the device has no onboard GPS fix, plus a
  local push notification and an on-device SOS history log.
- **Emergency Broadcast** — operator-initiated alerts sent to every duck on
  the mesh simultaneously appear as a red banner with a push notification,
  distinct from regular one-to-one messages.
- Operators can remotely poll a duck for its current GPS fix; the app
  auto-replies with the latest location within 5 seconds.

### 💬 Messaging to the Operator
- Compose and send free-text messages with a selectable **urgency level**
  (low / medium / critical) and optional GPS tag, relayed to the Emergency
  Command Center over the mesh.
- Persistent **message history** (sent + received) stored locally on-device,
  with local notifications for new incoming messages.

### 🦆 Peer-to-Peer Decentralized Mesh Messaging (Meshtastic-style Direct Chat)
- **Direct Chat** lets two people message each other duck-to-duck over LoRa,
  independent of the Command Center, like Meshtastic-style peer messaging.
- **Address Book** for saving frequently-contacted duck IDs under friendly
  names instead of raw 8-character identifiers.
- **Mutual location tracking** — opt-in GPS ping exchange every 2 minutes
  between two peers, shown as a live countdown banner and rendered as
  location-update cards in the chat thread.
- **Nearby Ducks** discovery — the app passively tracks every duck heard on
  the mesh (via relayed packets and chat pings), showing duck type, last-seen
  time, and whether that duck has a phone currently attached.

### 🗺️ Live Map with Offline Map Download
- Full-screen interactive map (MapLibre + OpenStreetMap-based OpenFreeMap
  tiles) showing your live GPS position and nearby mesh nodes.
- **Download Area** — fetch a ~30 km × 30 km offline tile pack centred on
  your current position for use with zero internet connectivity, with a
  live download progress bar and stored-size indicator.
- Delete the offline pack at any time to free up storage.

### 🔌 Device Connectivity
- Automatic transport selection: **USB serial** on Android (cable), **BLE
  (Nordic UART Service)** on iOS and optionally Android.
- Live connection status banner, BLE device scanner with RSSI signal
  strength, and automatic disconnect detection.
- Device Info card showing battery level and device ID, reported directly
  from the duck.
- LoRa radio region selector (MY/SG/PH/ID/US/UK presets) for compliance with
  local frequency regulations.

### ⚙️ Settings
- Emergency contacts management and personal Medical ID editing, bundled
  with any SOS/message sent to the operator.

For the full wire protocol, frame formats, and firmware reference, see
[CDK_PROTOCOL.md](CDK_PROTOCOL.md).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
