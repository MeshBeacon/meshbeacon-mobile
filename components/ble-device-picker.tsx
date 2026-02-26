/**
 * BleScanSheet
 *
 * A bottom sheet that scans for nearby ClusterDuck devices (NUS BLE) and
 * lets the user pick which one to connect to.
 */

import { useSerial } from "@/contexts/serial-context";
import type { ScannedDevice } from "@/services/ble";
import { bleService } from "@/services/ble";
import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";

function rssiSignal(rssi: number): { label: string; color: string } {
  if (rssi >= -60) return { label: "Strong", color: "#16a34a" };
  if (rssi >= -75) return { label: "Good", color: "#f27f0d" };
  return { label: "Weak", color: "#dc2626" };
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function BleScanSheet({ visible, onClose }: Props) {
  const { connectToBleDevice } = useSerial();
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDevices([]);
    setConnecting(null);

    stopScanRef.current = bleService.scanDevices((d) => {
      setDevices((prev) =>
        prev.some((x) => x.id === d.id) ? prev : [...prev, d],
      );
    });

    return () => {
      stopScanRef.current?.();
      stopScanRef.current = null;
    };
  }, [visible]);

  const handleSelect = async (deviceId: string) => {
    stopScanRef.current?.();
    setConnecting(deviceId);
    const ok = await connectToBleDevice(deviceId);
    setConnecting(null);
    if (ok) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>Nearby ClusterDuck Devices</Text>
          <ActivityIndicator size="small" color="#f27f0d" />
        </View>
        <Text style={styles.subtitle}>Scanning for devices via Bluetooth…</Text>

        {devices.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons
              name="bluetooth-searching"
              size={44}
              color="#d1d5db"
            />
            <Text style={styles.emptyText}>No devices found yet</Text>
            <Text style={styles.emptyHint}>
              Make sure the ESP32 is powered on and nearby
            </Text>
          </View>
        ) : (
          <FlatList
            data={devices}
            keyExtractor={(d) => d.id}
            style={styles.list}
            renderItem={({ item }) => {
              const sig = rssiSignal(item.rssi);
              const isConnecting = connecting === item.id;
              return (
                <Pressable
                  style={styles.deviceRow}
                  onPress={() => handleSelect(item.id)}
                  disabled={connecting !== null}
                >
                  <View style={styles.deviceIconWrap}>
                    <MaterialIcons name="memory" size={22} color="#f27f0d" />
                  </View>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={[styles.deviceRssi, { color: sig.color }]}>
                      {sig.label} · {item.rssi} dBm
                    </Text>
                  </View>
                  {isConnecting ? (
                    <ActivityIndicator size="small" color="#f27f0d" />
                  ) : (
                    <MaterialIcons
                      name="chevron-right"
                      size={22}
                      color="#9ca3af"
                    />
                  )}
                </Pressable>
              );
            }}
          />
        )}

        <Pressable style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
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
    paddingBottom: 36,
    paddingTop: 12,
    maxHeight: "70%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 99,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginBottom: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#181411",
  },
  subtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 16,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#9ca3af",
  },
  emptyHint: {
    fontSize: 12,
    color: "#c4b5a5",
    textAlign: "center",
  },
  list: {
    maxHeight: 280,
    marginBottom: 8,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0ebe6",
    gap: 12,
  },
  deviceIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#181411",
  },
  deviceRssi: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#6b7280",
  },
});
