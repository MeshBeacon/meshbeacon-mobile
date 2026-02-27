import { BleScanSheet } from "@/components/ble-device-picker";
import { useSerial } from "@/contexts/serial-context";
import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

function statusConfig(isBle: boolean) {
  const deviceIcon = isBle ? ("bluetooth" as const) : ("usb" as const);
  return {
    disconnected: {
      label: isBle
        ? "Device not found via Bluetooth"
        : "Device not connected via USB",
      action: "Connect",
      bg: "#fee2e2",
      text: "#b91c1c",
      icon: deviceIcon,
    },
    scanning: {
      label: "Scanning for device via Bluetooth…",
      action: null,
      bg: "#fef9c3",
      text: "#854d0e",
      icon: "bluetooth-searching" as const,
    },
    connecting: {
      label: isBle ? "Pairing with device…" : "Connecting to device…",
      action: null,
      bg: "#fef9c3",
      text: "#854d0e",
      icon: "sync" as const,
    },
    connected: {
      label: isBle
        ? "Device connected via Bluetooth"
        : "Device connected via USB",
      action: null,
      bg: "#dcfce7",
      text: "#15803d",
      icon: deviceIcon,
    },
    error: {
      label: "Connection error",
      action: "Retry",
      bg: "#fee2e2",
      text: "#b91c1c",
      icon: "warning" as const,
    },
  } as const;
}

interface Props {
  detail?: string;
}

export function SerialStatusBanner({ detail }: Props) {
  const { status, transportMode, setTransportMode, connect, disconnect } =
    useSerial();
  const isBle = transportMode === "ble";
  const cfg = statusConfig(isBle)[status];
  const showSpinner = status === "connecting" || status === "scanning";
  const isIdle = status === "disconnected" || status === "error";
  const [showPicker, setShowPicker] = useState(false);

  const handleConnect = () => {
    if (isBle) {
      setShowPicker(true);
    } else {
      connect();
    }
  };

  return (
    <View>
      <BleScanSheet visible={showPicker} onClose={() => setShowPicker(false)} />
      {/* USB / BLE toggle — Android only, shown when not actively connecting */}
      {Platform.OS === "android" && isIdle && (
        <View style={styles.toggle}>
          <Pressable
            onPress={() => setTransportMode("usb")}
            style={[styles.toggleBtn, !isBle && styles.toggleBtnActive]}
          >
            <MaterialIcons
              name="usb"
              size={14}
              color={!isBle ? "#fff" : "#6b7280"}
            />
            <Text
              style={[styles.toggleLabel, !isBle && styles.toggleLabelActive]}
            >
              USB
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTransportMode("ble")}
            style={[styles.toggleBtn, isBle && styles.toggleBtnActive]}
          >
            <MaterialIcons
              name="bluetooth"
              size={14}
              color={isBle ? "#fff" : "#6b7280"}
            />
            <Text
              style={[styles.toggleLabel, isBle && styles.toggleLabelActive]}
            >
              Bluetooth
            </Text>
          </Pressable>
        </View>
      )}

      {/* Status / connect banner */}
      <Pressable
        onPress={cfg.action ? handleConnect : undefined}
        style={[styles.banner, { backgroundColor: cfg.bg }]}
      >
        <View style={styles.row}>
          {showSpinner ? (
            <ActivityIndicator size="small" color={cfg.text} />
          ) : (
            <MaterialIcons name={cfg.icon} size={16} color={cfg.text} />
          )}
          <Text style={[styles.label, { color: cfg.text }]}>
            {detail && status === "error" ? detail : cfg.label}
          </Text>
        </View>
        {cfg.action && (
          <Text style={[styles.action, { color: cfg.text }]}>
            {cfg.action} →
          </Text>
        )}
        {status === "connected" && (
          <Pressable onPress={disconnect} hitSlop={8}>
            <MaterialIcons name="link-off" size={18} color={cfg.text} />
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    margin: 10,
    marginBottom: 0,
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: "#f27f0d",
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  toggleLabelActive: {
    color: "#fff",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  action: {
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 8,
  },
});
