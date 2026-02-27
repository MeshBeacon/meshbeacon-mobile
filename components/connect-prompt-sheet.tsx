/**
 * ConnectPromptSheet
 *
 * A bottom-sheet modal shown on Android app launch that lets the user pick
 * USB or Bluetooth before the app attempts to connect to the ESP32.
 *
 * On iOS this component renders nothing (BLE is the only option and the
 * existing status banner handles connection).
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

export function ConnectPromptSheet() {
  const { status, transportMode, setTransportMode, connect } = useSerial();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<"usb" | "ble">("usb");
  const [bleScanVisible, setBleScanVisible] = useState(false);

  // Show the prompt once on mount (Android only, when not already connected)
  useEffect(() => {
    if (Platform.OS === "android" && status === "disconnected") {
      setSelected(transportMode);
      setVisible(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (Platform.OS !== "android") return null;

  const handleConnect = async () => {
    setVisible(false);
    if (selected !== transportMode) {
      await setTransportMode(selected);
    }
    if (selected === "ble") {
      // Open the BLE scan sheet so the user can pick a specific device
      setBleScanVisible(true);
    } else {
      connect();
    }
  };

  const handleSkip = () => {
    setVisible(false);
  };

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
    alignItems: "center",
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
