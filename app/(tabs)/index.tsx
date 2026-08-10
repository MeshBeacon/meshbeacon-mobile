import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SerialStatusBanner } from "@/components/serial-status-banner";
import { useLocationCtx } from "@/contexts/location-context";
import { useSerial } from "@/contexts/serial-context";
import { useToast } from "@/contexts/toast-context";
import { useEsp32Data } from "@/hooks/use-esp32-data";

export default function HomeScreen() {
  const router = useRouter();
  const { status, sendSOS } = useSerial();
  const gps = useLocationCtx();
  const esp32 = useEsp32Data();
  const { showToast, showConfirm } = useToast();
  const [sending, setSending] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [showAllBroadcasts, setShowAllBroadcasts] = useState(false);
  const [expandedBroadcasts, setExpandedBroadcasts] = useState<Set<string>>(
    new Set(),
  );

  // Show an in-app confirmation when OpenDMS acknowledges the SOS.
  const prevSosAckRef = useRef(esp32.lastSosAck);
  useEffect(() => {
    if (esp32.lastSosAck && esp32.lastSosAck !== prevSosAckRef.current) {
      prevSosAckRef.current = esp32.lastSosAck;
      showToast("SOS confirmed by operator — help is on the way.", "success");
    }
  }, [esp32.lastSosAck, showToast]);

  const toggleBroadcastExpand = (id: string) =>
    setExpandedBroadcasts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSOS = useCallback(async () => {
    if (status === "disconnected" || status === "error") {
      showToast(
        "Connect to the device first by tapping the banner above.",
        "error",
      );
      return;
    }
    const location = gps.status === "ready" ? gps.coords : undefined;
    showConfirm({
      title: "Send SOS?",
      message:
        gps.status === "ready"
          ? `SOS will be sent with your GPS coordinates (${gps.coords.latitude.toFixed(4)}, ${gps.coords.longitude.toFixed(4)}).`
          : "GPS unavailable. SOS will be sent without coordinates.",
      confirmText: "SEND SOS",
      destructive: true,
      onConfirm: async () => {
        setSending(true);
        try {
          await sendSOS(location);
          showToast("Emergency signal transmitted to the device.", "success");
        } catch (err) {
          showToast((err as Error).message, "error");
        } finally {
          setSending(false);
        }
      },
    });
  }, [status, gps]);

  const gpsLabel = () => {
    switch (gps.status) {
      case "idle":
      case "requesting":
        return "Acquiring GPS…";
      case "denied":
        return "GPS permission denied";
      case "error":
        return "GPS error";
      case "ready":
        return `${gps.coords.latitude.toFixed(5)}, ${gps.coords.longitude.toFixed(5)}`;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>MeshBeacon</Text>
          <Pressable
            style={styles.newMessageBtn}
            onPress={() => router.push("/(tabs)/messages")}
          >
            <MaterialIcons name="edit-note" size={20} color="#f27f0d" />
          </Pressable>
        </View>

        <SerialStatusBanner />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* GPS card */}
          <View style={styles.gpsCard}>
            <View style={styles.gpsIconWrap}>
              <MaterialIcons
                name="location-on"
                size={24}
                color={gps.status === "ready" ? "#f27f0d" : "#9ca3af"}
              />
            </View>
            <View style={styles.gpsTexts}>
              <Text style={styles.gpsTitleText}>GPS Location</Text>
              <Text
                style={[
                  styles.gpsValue,
                  gps.status !== "ready" && styles.gpsValueMuted,
                ]}
              >
                {gpsLabel()}
              </Text>
            </View>
            {(gps.status === "idle" || gps.status === "requesting") && (
              <ActivityIndicator size="small" color="#f27f0d" />
            )}
          </View>

          {/* ESP32 device info card — shown only when connected */}
          {status === "connected" && (
            <View style={styles.deviceCard}>
              <View style={styles.deviceRow}>
                <View style={styles.deviceIconWrap}>
                  <MaterialIcons name="memory" size={20} color="#f27f0d" />
                </View>
                <View style={styles.deviceTexts}>
                  <Text style={styles.deviceLabel}>Device ID</Text>
                  <Text style={styles.deviceValue}>
                    {esp32.deviceId ?? "Waiting for device…"}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.deviceRow}>
                <View style={styles.deviceIconWrap}>
                  <MaterialIcons
                    name={
                      esp32.battery === null
                        ? "battery-unknown"
                        : esp32.battery > 80
                          ? "battery-full"
                          : esp32.battery > 50
                            ? "battery-5-bar"
                            : esp32.battery > 20
                              ? "battery-3-bar"
                              : "battery-1-bar"
                    }
                    size={20}
                    color={
                      esp32.battery === null
                        ? "#9ca3af"
                        : esp32.battery > 20
                          ? "#16a34a"
                          : "#dc2626"
                    }
                  />
                </View>
                <View style={styles.deviceTexts}>
                  <Text style={styles.deviceLabel}>Device Battery</Text>
                  {esp32.battery === null ? (
                    <Text style={[styles.deviceValue, styles.deviceValueMuted]}>
                      Waiting for device…
                    </Text>
                  ) : (
                    <View style={styles.battRow}>
                      <View style={styles.battTrack}>
                        <View
                          style={[
                            styles.battFill,
                            {
                              width: `${esp32.battery}%` as `${number}%`,
                              backgroundColor:
                                esp32.battery > 20 ? "#16a34a" : "#dc2626",
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.battPct,
                          { color: esp32.battery > 20 ? "#16a34a" : "#dc2626" },
                        ]}
                      >
                        {esp32.battery}%
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* SOS button */}
          <View style={styles.sosWrap}>
            <Pressable
              style={[styles.sosButton, sending && styles.sosButtonDisabled]}
              onPress={handleSOS}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator size="large" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="warning" size={42} color="#fff" />
                  <Text style={styles.sosText}>SOS</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.sosHint}>
              {status === "connected"
                ? "Tap to send emergency signal"
                : "Connect ESP32 to enable"}
            </Text>
          </View>

          {/* SOS acknowledgement banner — shown once operator confirms receipt */}
          {esp32.lastSosAck && (
            <View style={styles.sosAckBanner}>
              <View style={styles.sosAckIconWrap}>
                <MaterialIcons name="check-circle" size={28} color="#16a34a" />
              </View>
              <View style={styles.sosAckTexts}>
                <Text style={styles.sosAckTitle}>SOS Received by Operator</Text>
                <Text style={styles.sosAckBody}>Help is on the way.</Text>
                <Text style={styles.sosAckTime}>
                  {new Date(esp32.lastSosAck.receivedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
          )}

          {/* Emergency broadcast alerts */}
          {esp32.broadcastAlerts.length > 0 && (
            <View style={styles.bcastCard}>
              <View style={styles.bcastHeader}>
                <MaterialIcons name="campaign" size={17} color="#dc2626" />
                <Text style={styles.bcastTitle}>Emergency Broadcast</Text>
                <View style={styles.bcastBadge}>
                  <Text style={styles.bcastBadgeText}>
                    {esp32.broadcastAlerts.length}
                  </Text>
                </View>
              </View>
              {(showAllBroadcasts
                ? esp32.broadcastAlerts
                : esp32.broadcastAlerts.slice(0, 2)
              ).map((b) => {
                const isLong = b.text.length > 120;
                const isExpanded = expandedBroadcasts.has(b.id);
                return (
                  <View key={b.id} style={styles.bcastRow}>
                    <Text style={styles.bcastTime}>
                      {new Date(b.receivedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    <Text
                      style={styles.bcastText}
                      numberOfLines={isLong && !isExpanded ? 3 : undefined}
                    >
                      {b.text}
                    </Text>
                    {isLong && (
                      <Pressable
                        onPress={() => toggleBroadcastExpand(b.id)}
                        style={styles.bcastReadMore}
                      >
                        <Text style={styles.bcastReadMoreText}>
                          {isExpanded ? "Show less" : "Read more"}
                        </Text>
                        <MaterialIcons
                          name={isExpanded ? "expand-less" : "expand-more"}
                          size={14}
                          color="#dc2626"
                        />
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {esp32.broadcastAlerts.length > 2 && (
                <Pressable
                  style={styles.bcastToggle}
                  onPress={() => setShowAllBroadcasts((v) => !v)}
                >
                  <Text style={styles.bcastToggleText}>
                    {showAllBroadcasts
                      ? "Show less"
                      : `Show all ${esp32.broadcastAlerts.length} broadcasts`}
                  </Text>
                  <MaterialIcons
                    name={showAllBroadcasts ? "expand-less" : "expand-more"}
                    size={16}
                    color="#dc2626"
                  />
                </Pressable>
              )}
            </View>
          )}

          {/* Incoming LoRa messages */}
          <View style={styles.incomingCard}>
            <View style={styles.incomingHeader}>
              <MaterialIcons name="move-to-inbox" size={16} color="#f27f0d" />
              <Text style={styles.incomingTitle}>Incoming Alerts</Text>
              {esp32.incomingMessages.length > 0 && (
                <View style={styles.incomingBadge}>
                  <Text style={styles.incomingBadgeText}>
                    {esp32.incomingMessages.length}
                  </Text>
                </View>
              )}
            </View>
            {esp32.incomingMessages.length === 0 ? (
              <View style={styles.incomingEmpty}>
                <MaterialIcons name="inbox" size={28} color="#d1c5b8" />
                <Text style={styles.incomingEmptyText}>
                  No alerts received yet
                </Text>
                <Text style={styles.incomingEmptyHint}>
                  Alerts relayed over LoRa will appear here
                </Text>
              </View>
            ) : (
              <>
                {(showAllMessages
                  ? esp32.incomingMessages
                  : esp32.incomingMessages.slice(0, 3)
                ).map((msg, i) => (
                  <View key={msg.receivedAt + i} style={styles.incomingRow}>
                    <Text style={styles.incomingTime}>
                      {new Date(msg.receivedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    <Text style={styles.incomingText}>{msg.text}</Text>
                  </View>
                ))}
                {esp32.incomingMessages.length > 3 && (
                  <Pressable
                    style={styles.incomingToggle}
                    onPress={() => setShowAllMessages((v) => !v)}
                  >
                    <Text style={styles.incomingToggleText}>
                      {showAllMessages
                        ? "Show less"
                        : `Show all ${esp32.incomingMessages.length} alerts`}
                    </Text>
                    <MaterialIcons
                      name={showAllMessages ? "expand-less" : "expand-more"}
                      size={16}
                      color="#f27f0d"
                    />
                  </Pressable>
                )}
              </>
            )}
          </View>

          {/* Quick actions */}
          <Pressable
            style={styles.actionCard}
            onPress={() => router.push("/(tabs)/messages")}
          >
            <View style={styles.actionIcon}>
              <MaterialIcons name="message" size={20} color="#f27f0d" />
            </View>
            <View style={styles.actionTexts}>
              <Text style={styles.actionTitle}>New Message</Text>
              <Text style={styles.actionSub}>Send text via serial or BLE</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#c8bdb0" />
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e6e0db",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#181411",
    letterSpacing: -0.3,
  },
  newMessageBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#f27f0d1a",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { gap: 20, paddingHorizontal: 16, paddingVertical: 20 },
  gpsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    padding: 14,
  },
  gpsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#f27f0d14",
    alignItems: "center",
    justifyContent: "center",
  },
  gpsTexts: { flex: 1 },
  gpsTitleText: { fontSize: 14, fontWeight: "600", color: "#181411" },
  gpsValue: { marginTop: 2, fontSize: 13, color: "#f27f0d", fontWeight: "500" },
  gpsValueMuted: { color: "#9ca3af" },
  // Device info card
  deviceCard: {
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    padding: 14,
    gap: 0,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  deviceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f27f0d14",
    alignItems: "center",
    justifyContent: "center",
  },
  deviceTexts: { flex: 1 },
  deviceLabel: { fontSize: 12, color: "#8a7560", fontWeight: "500" },
  deviceValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#181411",
    marginTop: 1,
  },
  deviceValueMuted: { color: "#9ca3af", fontWeight: "400" },
  divider: { height: 1, backgroundColor: "#e6e0db", marginVertical: 8 },
  battRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  battTrack: {
    flex: 1,
    height: 8,
    borderRadius: 99,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  battFill: { height: "100%", borderRadius: 99 },
  battPct: { fontSize: 13, fontWeight: "700", minWidth: 36 },
  sosWrap: { alignItems: "center", gap: 14, paddingVertical: 12 },
  sosButton: {
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "#dc2626",
    borderWidth: 6,
    borderColor: "#fca5a5",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#dc2626",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  sosButtonDisabled: { opacity: 0.6 },
  sosText: { color: "#fff", fontSize: 28, fontWeight: "900", marginTop: -4 },
  sosHint: { fontSize: 13, color: "#8a7560", fontWeight: "500" },
  sosAckBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f0fdf4",
    borderWidth: 1.5,
    borderColor: "#86efac",
    borderRadius: 12,
    padding: 14,
  },
  sosAckIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  sosAckTexts: { flex: 1 },
  sosAckTitle: { fontSize: 14, fontWeight: "700", color: "#15803d" },
  sosAckBody: { fontSize: 13, color: "#16a34a", marginTop: 2 },
  sosAckTime: { fontSize: 11, color: "#6b7280", marginTop: 4 },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    padding: 14,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#f27f0d14",
    alignItems: "center",
    justifyContent: "center",
  },
  actionTexts: { flex: 1, gap: 2 },
  actionTitle: { fontSize: 15, fontWeight: "700", color: "#181411" },
  actionSub: { fontSize: 12, color: "#8a7560" },
  // Incoming LoRa messages card
  incomingCard: {
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  incomingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  incomingTitle: { fontSize: 14, fontWeight: "700", color: "#181411", flex: 1 },
  incomingBadge: {
    backgroundColor: "#f27f0d",
    borderRadius: 99,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  incomingBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  incomingEmpty: {
    alignItems: "center",
    paddingVertical: 20,
    gap: 6,
  },
  incomingEmptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#b0a090",
  },
  incomingEmptyHint: {
    fontSize: 12,
    color: "#c8bdb0",
    textAlign: "center",
  },
  incomingRow: {
    gap: 3,
    borderLeftWidth: 3,
    borderLeftColor: "#f27f0d",
    paddingLeft: 10,
  },
  incomingTime: { fontSize: 11, color: "#9ca3af", marginBottom: 1 },
  incomingText: { fontSize: 14, color: "#181411", lineHeight: 20 },
  incomingToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#f0ebe6",
    marginTop: 2,
  },
  incomingToggleText: { fontSize: 13, color: "#f27f0d", fontWeight: "600" },
  // Emergency broadcast card
  bcastCard: {
    borderWidth: 2,
    borderColor: "#dc2626",
    borderRadius: 12,
    padding: 14,
    gap: 10,
    backgroundColor: "#fff5f5",
  },
  bcastHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  bcastTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#dc2626",
    flex: 1,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  bcastBadge: {
    backgroundColor: "#dc2626",
    borderRadius: 99,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  bcastBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  bcastRow: {
    gap: 3,
    borderLeftWidth: 3,
    borderLeftColor: "#dc2626",
    paddingLeft: 10,
    paddingVertical: 2,
  },
  bcastTime: { fontSize: 11, color: "#9ca3af", marginBottom: 1 },
  bcastText: {
    fontSize: 14,
    color: "#7f1d1d",
    fontWeight: "600",
    lineHeight: 20,
    flexShrink: 1,
  },
  bcastReadMore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 2,
    alignSelf: "flex-start",
  },
  bcastReadMoreText: {
    fontSize: 12,
    color: "#dc2626",
    fontWeight: "600",
  },
  bcastToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#fecaca",
    marginTop: 2,
  },
  bcastToggleText: { fontSize: 13, color: "#dc2626", fontWeight: "600" },
});
