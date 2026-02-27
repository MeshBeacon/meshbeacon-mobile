/**
 * ConnectPromptSheet
 *
 * A bottom-sheet modal shown on app launch that prompts the user to connect
 * to their ClusterDuck device.
 *
 * Android: lets the user pick USB or Bluetooth.
 * iOS:     Bluetooth is the only option, so shows a simpler prompt that goes
 *          straight to the BLE scan sheet.
 */

import { BleScanSheet } from "@/components/ble-device-picker";
import { useSerial } from "@/contexts/serial-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── iOS ── simple Bluetooth-only prompt ──────────────────────────────────────

function IosConnectPrompt() {
  const { status } = useSerial();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [bleScanVisible, setBleScanVisible] = useState(false);

  useEffect(() => {
    if (status === "disconnected") setVisible(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = () => {
    setVisible(false);
    setBleScanVisible(true);
  };

  const handleSkip = () => setVisible(false);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={handleSkip}
      >
        <Pressable style={styles.backdrop} onPress={handleSkip} />

        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(36, bottomInset + 16) },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.iosIconWrap}>
            <MaterialIcons name="bluetooth" size={36} color="#fff" />
          </View>

          <Text style={styles.title}>Connect via Bluetooth</Text>
          <Text style={styles.subtitle}>
            Scan for a nearby ClusterDuck device to send messages and SOS
            alerts.
          </Text>

          <Pressable style={styles.connectBtn} onPress={handleConnect}>
            <MaterialIcons
              name="bluetooth-searching"
              size={18}
              color="#fff"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.connectBtnText}>Scan for Devices</Text>
          </Pressable>

          <Pressable style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip for now</Text>
          </Pressable>
        </View>
      </Modal>

      <BleScanSheet
        visible={bleScanVisible}
        onClose={() => setBleScanVisible(false)}
      />
    </>
  );
}

// ── Android ── USB / BLE picker ───────────────────────────────────────────────

function AndroidConnectPrompt() {
  const { status, transportMode, setTransportMode, connect } = useSerial();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<"usb" | "ble">("usb");
  const [bleScanVisible, setBleScanVisible] = useState(false);

  // Show the prompt once on mount when not already connected
  useEffect(() => {
    if (status === "disconnected") {
      setSelected(transportMode);
      setVisible(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    setVisible(false);
    if (selected !== transportMode) {
      await setTransportMode(selected);
    }
    if (selected === "ble") {
      setBleScanVisible(true);
    } else {
      connect();
    }
  };

  const handleSkip = () => setVisible(false);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={handleSkip}
      >
        <Pressable style={styles.backdrop} onPress={handleSkip} />

        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(36, bottomInset + 16) },
          ]}
        >
          <View style={styles.handle} />

          <Text style={styles.title}>Connect to Device</Text>
          <Text style={styles.subtitle}>
            How do you want to connect to your device?
          </Text>

          <View style={styles.options}>
            {/* USB option */}
            <Pressable
              style={[
                styles.option,
                selected === "usb" && styles.optionSelected,
              ]}
              onPress={() => setSelected("usb")}
            >
              <View
                style={[
                  styles.optionIcon,
                  selected === "usb" && styles.optionIconSelected,
                ]}
              >
                <MaterialIcons
                  name="usb"
                  size={28}
                  color={selected === "usb" ? "#fff" : "#6b7280"}
                />
              </View>
              <Text
                style={[
                  styles.optionLabel,
                  selected === "usb" && styles.optionLabelSelected,
                ]}
              >
                USB Cable
              </Text>
              <Text style={styles.optionSub}>
                Faster · reliable · requires data cable
              </Text>
              {selected === "usb" && (
                <MaterialIcons
                  name="check-circle"
                  size={18}
                  color="#f27f0d"
                  style={styles.check}
                />
              )}
            </Pressable>

            {/* BLE option */}
            <Pressable
              style={[
                styles.option,
                selected === "ble" && styles.optionSelected,
              ]}
              onPress={() => setSelected("ble")}
            >
              <View
                style={[
                  styles.optionIcon,
                  selected === "ble" && styles.optionIconSelected,
                ]}
              >
                <MaterialIcons
                  name="bluetooth"
                  size={28}
                  color={selected === "ble" ? "#fff" : "#6b7280"}
                />
              </View>
              <Text
                style={[
                  styles.optionLabel,
                  selected === "ble" && styles.optionLabelSelected,
                ]}
              >
                Bluetooth
              </Text>
              <Text style={styles.optionSub}>
                Wireless · requires pairing nearby
              </Text>
              {selected === "ble" && (
                <MaterialIcons
                  name="check-circle"
                  size={18}
                  color="#f27f0d"
                  style={styles.check}
                />
              )}
            </Pressable>
          </View>

          <Pressable style={styles.connectBtn} onPress={handleConnect}>
            <Text style={styles.connectBtnText}>Connect</Text>
          </Pressable>

          <Pressable style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipBtnText}>Skip for now</Text>
          </Pressable>
        </View>
      </Modal>

      <BleScanSheet
        visible={bleScanVisible}
        onClose={() => setBleScanVisible(false)}
      />
    </>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function ConnectPromptSheet() {
  if (Platform.OS === "ios") return <IosConnectPrompt />;
  return <AndroidConnectPrompt />;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 0,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 20,
  },
  iosIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#181411",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
  },
  options: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  option: {
    flex: 1,
    borderWidth: 2,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    gap: 6,
    position: "relative",
  },
  optionSelected: {
    borderColor: "#f27f0d",
    backgroundColor: "#fff7ed",
  },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  optionIconSelected: {
    backgroundColor: "#f27f0d",
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },
  optionLabelSelected: {
    color: "#f27f0d",
  },
  optionSub: {
    fontSize: 11,
    color: "#9ca3af",
    textAlign: "center",
  },
  check: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  connectBtn: {
    backgroundColor: "#f27f0d",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  connectBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 8,
  },
  skipBtnText: {
    fontSize: 14,
    color: "#9ca3af",
    fontWeight: "600",
  },
});
