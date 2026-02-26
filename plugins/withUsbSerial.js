/**
 * Expo config plugin — adds Android USB Host support for USB serial devices.
 *
 * What it does to AndroidManifest.xml:
 *  1. Adds <uses-feature android:name="android.hardware.usb.host" />
 *  2. Adds a USB_DEVICE_ATTACHED intent-filter to MainActivity so Android
 *     shows the "Allow app to access device?" dialog when an ESP32 (or USB
 *     serial adapter) is plugged in.
 *  3. Copies res/xml/usb_device_filter.xml into the app resources.
 *
 * Registered in app.json under "plugins".
 */

const {
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

// ── Step 1: add <uses-feature> + intent-filter to the manifest ────────────────
function withUsbManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;

    // 1a. <uses-feature android:name="android.hardware.usb.host" />
    if (!manifest.manifest["uses-feature"]) {
      manifest.manifest["uses-feature"] = [];
    }
    const features = manifest.manifest["uses-feature"];
    const alreadyHasUsbHost = features.some(
      (f) => f.$?.["android:name"] === "android.hardware.usb.host",
    );
    if (!alreadyHasUsbHost) {
      features.push({ $: { "android:name": "android.hardware.usb.host" } });
    }

    // 1b. Add intent-filter + meta-data to MainActivity
    const app = manifest.manifest.application?.[0];
    if (app) {
      const activities = app.activity ?? [];
      const mainActivity = activities.find(
        (a) => a.$?.["android:name"] === ".MainActivity",
      );
      if (mainActivity) {
        // Intent filter for USB device attached
        if (!mainActivity["intent-filter"]) mainActivity["intent-filter"] = [];
        const alreadyHasUsbFilter = mainActivity["intent-filter"].some((f) =>
          f.action?.some(
            (a) =>
              a.$?.["android:name"] ===
              "android.hardware.usb.action.USB_DEVICE_ATTACHED",
          ),
        );
        if (!alreadyHasUsbFilter) {
          mainActivity["intent-filter"].push({
            action: [
              {
                $: {
                  "android:name":
                    "android.hardware.usb.action.USB_DEVICE_ATTACHED",
                },
              },
            ],
          });
        }

        // meta-data pointing to the device filter resource
        if (!mainActivity["meta-data"]) mainActivity["meta-data"] = [];
        const alreadyHasMeta = mainActivity["meta-data"].some(
          (m) =>
            m.$?.["android:name"] ===
            "android.hardware.usb.action.USB_DEVICE_ATTACHED",
        );
        if (!alreadyHasMeta) {
          mainActivity["meta-data"].push({
            $: {
              "android:name": "android.hardware.usb.action.USB_DEVICE_ATTACHED",
              "android:resource": "@xml/usb_device_filter",
            },
          });
        }
      }
    }

    return mod;
  });
}

// ── Step 2: copy usb_device_filter.xml into android/app/src/main/res/xml ─────
function withUsbDeviceFilter(config) {
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const src = path.resolve(__dirname, "usb_device_filter_source.xml");
      const destDir = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      const dest = path.join(destDir, "usb_device_filter.xml");

      fs.mkdirSync(destDir, { recursive: true });

      // Only copy from source file if it exists; otherwise trust the file
      // already committed at the destination path.
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      } else if (!fs.existsSync(dest)) {
        // Write a sensible default if neither exists
        fs.writeFileSync(
          dest,
          `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <usb-device vendor-id="4292" product-id="60000" />
  <usb-device vendor-id="6790" product-id="29987" />
  <usb-device vendor-id="6790" product-id="21795" />
  <usb-device vendor-id="1027" product-id="24577" />
  <usb-device vendor-id="1659" product-id="8963" />
  <usb-device vendor-id="12346" product-id="4097" />
</resources>`,
        );
      }

      return mod;
    },
  ]);
}

module.exports = function withUsbSerial(config) {
  config = withUsbManifest(config);
  config = withUsbDeviceFilter(config);
  return config;
};
