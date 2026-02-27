import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SerialStatusBanner } from "@/components/serial-status-banner";
import { useLocationCtx } from "@/contexts/location-context";
import { useMessageStoreCtx } from "@/contexts/message-store-context";
import { useSerial } from "@/contexts/serial-context";
import { useToast } from "@/contexts/toast-context";

const URGENCY_OPTIONS = ["Low Urgency", "Medium", "Critical"] as const;

export default function NewMessageScreen() {
  const router = useRouter();
  const { status, sendMessage } = useSerial();
  const { addSent } = useMessageStoreCtx();
  const gps = useLocationCtx();
  const [message, setMessage] = useState("");
  const [attachGps, setAttachGps] = useState(true);
  const [urgency, setUrgency] =
    useState<(typeof URGENCY_OPTIONS)[number]>("Low Urgency");
  const [sending, setSending] = useState(false);

  // Block send while GPS hasn't produced its first fix yet.
  // "idle" = LocationProvider effect hasn't run yet; "requesting" = acquiring.
  const gpsAcquiring =
    attachGps && (gps.status === "idle" || gps.status === "requesting");
  const { showToast } = useToast();

  const urgencyKey = (
    u: (typeof URGENCY_OPTIONS)[number],
  ): "low" | "medium" | "critical" => {
    if (u === "Low Urgency") return "low";
    if (u === "Critical") return "critical";
    return "medium";
  };

  const handleSend = async () => {
    if (!message.trim()) {
      showToast("Please type a message before sending.", "warning");
      return;
    }
    if (status === "disconnected" || status === "error") {
      showToast("Connect to the ESP32 device first.", "error");
      return;
    }
    const location =
      attachGps && gps.status === "ready" ? gps.coords : undefined;
    setSending(true);
    try {
      await sendMessage({
        text: message,
        urgency: urgencyKey(urgency),
        location,
      });
      addSent(message, {
        urgency: urgencyKey(urgency),
        hasLocation: location !== undefined,
      });
      showToast(
        location
          ? `Message sent with GPS (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}).`
          : "Message sent (no GPS location attached).",
        "success",
      );
      setUrgency("Low Urgency");
      router.back();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={22} color="#181411" />
          </Pressable>
          <Text style={styles.headerTitle}>New Message</Text>
          <View style={styles.alertBadge}>
            <MaterialIcons name="emergency-share" size={20} color="#f27f0d" />
          </View>
        </View>

        <SerialStatusBanner />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.mapCard}>
            <Image
              source={{
                uri: "https://lh3.googleusercontent.com/aida-public/AB6AXuAtWaUFxhcIojBuIjuH0CKWfmHHgvbrhIpgphWlPGCS8kRuGuSgmRSt5OqRFNVUg_k5xqNyb8SaopVHtKldlqqV2RqlacKP00Acq7Cua4ctL08VwOgcYITrJAfxzhJ0DZoOqZVLeGnbGqaba8errLQ4lZ-YUmyNfxEsr4R2mmhPvHZ4ceT39MFC8wRByOKvmgcyvEmfay3C4qt4cP3zE2005Ca2qtqQ8_HMMV5WTcL0M9W3J9ljXk3jNrYTmvk1YnXptWqZXBvrTrVs",
              }}
              style={styles.mapImage}
            />
            <View style={styles.locationPin}>
              <MaterialIcons name="location-on" size={20} color="#fff" />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Type your emergency message here..."
              placeholderTextColor="#8a7560"
              multiline
              textAlignVertical="top"
              maxLength={180}
              style={styles.messageInput}
            />
            <Text
              style={[
                styles.charCounter,
                message.length >= 180 && { color: "#d32f2f" },
              ]}
            >
              {message.length}/180
            </Text>
          </View>

          <View style={styles.gpsCard}>
            <View style={styles.gpsLeft}>
              <View style={styles.gpsIconWrap}>
                <MaterialIcons name="pin-drop" size={26} color="#f27f0d" />
              </View>
              <View>
                <Text style={styles.gpsTitle}>Attach GPS Location</Text>
                <Text style={styles.gpsSubtitle}>
                  {gps.status === "ready"
                    ? `${gps.coords.latitude.toFixed(5)}, ${gps.coords.longitude.toFixed(5)}`
                    : "Acquiring…"}
                </Text>
              </View>
            </View>
            <Switch
              value={attachGps}
              onValueChange={setAttachGps}
              trackColor={{ true: "#f27f0d" }}
            />
          </View>

          <View style={styles.urgencyRow}>
            {URGENCY_OPTIONS.map((option) => {
              const active = urgency === option;
              const isCritical = option === "Critical";
              return (
                <Pressable
                  key={option}
                  onPress={() => setUrgency(option)}
                  style={[
                    styles.urgencyChip,
                    active && styles.urgencyChipActive,
                    isCritical && !active && styles.urgencyChipCritical,
                  ]}
                >
                  <Text
                    style={[
                      styles.urgencyChipText,
                      active && styles.urgencyChipTextActive,
                      isCritical && !active && styles.urgencyChipTextCritical,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[
              styles.sendButton,
              (sending || gpsAcquiring) && { opacity: 0.7 },
            ]}
            onPress={handleSend}
            disabled={sending || gpsAcquiring}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : gpsAcquiring ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.sendText}>ACQUIRING GPS…</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="send" size={20} color="#fff" />
                <Text style={styles.sendText}>SEND MESSAGE</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e6e0db",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f5f3f1",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#181411",
  },
  alertBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f27f0d1a",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    gap: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  mapCard: {
    height: 130,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e6e0db",
    justifyContent: "center",
    alignItems: "center",
  },
  mapImage: {
    width: "100%",
    height: "100%",
    opacity: 0.8,
  },
  locationPin: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#181411",
  },
  messageInput: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    color: "#181411",
    lineHeight: 24,
  },
  charCounter: {
    alignSelf: "flex-end",
    marginTop: 4,
    fontSize: 12,
    color: "#8a7560",
  },
  gpsCard: {
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  gpsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  gpsIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "#f27f0d1a",
    alignItems: "center",
    justifyContent: "center",
  },
  gpsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#181411",
  },
  gpsSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: "#8a7560",
  },
  urgencyRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  urgencyChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f27f0d",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  urgencyChipActive: {
    backgroundColor: "#f27f0d",
  },
  urgencyChipCritical: {
    borderColor: "#dc2626",
  },
  urgencyChipText: {
    fontSize: 13,
    color: "#f27f0d",
    fontWeight: "600",
  },
  urgencyChipTextActive: {
    color: "#fff",
  },
  urgencyChipTextCritical: {
    color: "#dc2626",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#e6e0db",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  sendButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: "#f27f0d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  sendText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
