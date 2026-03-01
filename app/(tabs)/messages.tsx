import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
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

const URGENCY_OPTIONS = ["Low", "Medium", "Critical"] as const;
type UrgencyOption = (typeof URGENCY_OPTIONS)[number];

function urgencyKey(u: UrgencyOption): "low" | "medium" | "critical" {
  if (u === "Low") return "low";
  if (u === "Critical") return "critical";
  return "medium";
}

export default function MessagesScreen() {
  const { status, sendMessage } = useSerial();
  const { messages, loaded, addSent } = useMessageStoreCtx();
  const { showToast } = useToast();
  const gps = useLocationCtx();
  const scrollRef = useRef<ScrollView>(null);
  const initialScrollDone = useRef(false);
  const keyboardVisible = useRef(false);

  // Scroll to bottom whenever a new message arrives.
  // Use animation for subsequent messages; skip it for the initial load.
  // When the keyboard is open, use a longer delay so KeyboardAvoidingView
  // finishes reshaping the layout before we compute the end position.
  useEffect(() => {
    if (!loaded) return;
    const animated = initialScrollDone.current;
    const delay = keyboardVisible.current ? 150 : 80;
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated });
      initialScrollDone.current = true;
    }, delay);
  }, [messages.length, loaded]);

  // Track keyboard visibility and re-scroll when the keyboard opens so the
  // latest message stays visible above the compose panel.
  useEffect(() => {
    const onShow = () => {
      keyboardVisible.current = true;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    };
    const onHide = () => {
      keyboardVisible.current = false;
    };
    const showSub = Keyboard.addListener("keyboardDidShow", onShow);
    const hideSub = Keyboard.addListener("keyboardDidHide", onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [message, setMessage] = useState("");
  const [attachGps, setAttachGps] = useState(true);
  const [urgency, setUrgency] = useState<UrgencyOption>("Low");
  const [sending, setSending] = useState(false);

  // Never block the send button on GPS state — the GPS pill already shows
  // "Acquiring…" so the user knows. If GPS isn't ready when they tap send,
  // the message goes without coordinates (which is correct behaviour).
  const gpsAcquiring = false;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return isToday
      ? time
      : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  };

  const handleSend = async () => {
    if (!message.trim()) {
      showToast("Please type a message before sending.", "warning");
      return;
    }
    if (status === "disconnected" || status === "error") {
      showToast("Connect to the device first.", "error");
      return;
    }
    console.log(
      "[MSG/send] attachGps:",
      attachGps,
      "gps.status:",
      gps.status,
      "coords:",
      gps.status === "ready" ? gps.coords : null,
    );
    const location =
      attachGps && gps.status === "ready" ? gps.coords : undefined;
    console.log("[MSG/send] location to be sent:", location ?? "none");
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
          ? `Sent with GPS (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}).`
          : "Message sent (no GPS).",
        "success",
      );
      setMessage("");
      setUrgency("Low");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.title}>Alert</Text>
            <MaterialIcons name="emergency-share" size={20} color="#f27f0d" />
          </View>

          <SerialStatusBanner />

          {/* ── History ── */}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (keyboardVisible.current) {
                scrollRef.current?.scrollToEnd({ animated: true });
              }
            }}
          >
            {loaded && messages.length === 0 && (
              <View style={styles.emptyState}>
                <MaterialIcons name="forum" size={40} color="#d1c5b8" />
                <Text style={styles.emptyTitle}>No alerts yet</Text>
                <Text style={styles.emptyHint}>
                  Sent and received emergency alerts will appear here
                </Text>
              </View>
            )}

            {[...messages].reverse().map((msg) => {
              const isSent = msg.direction === "sent";
              return (
                <View
                  key={msg.id}
                  style={[
                    styles.bubbleRow,
                    isSent ? styles.bubbleRowSent : styles.bubbleRowReceived,
                  ]}
                >
                  {/* Avatar dot for received */}
                  {!isSent && (
                    <View style={styles.avatar}>
                      <MaterialIcons name="cell-tower" size={14} color="#fff" />
                    </View>
                  )}

                  <View
                    style={[
                      styles.bubbleCol,
                      isSent ? styles.bubbleColSent : styles.bubbleColReceived,
                    ]}
                  >
                    {/* Urgency tag above bubble for critical sent messages */}
                    {isSent && msg.urgency === "critical" && (
                      <View style={styles.critTag}>
                        <MaterialIcons
                          name="warning"
                          size={11}
                          color="#dc2626"
                        />
                        <Text style={styles.critTagText}>CRITICAL</Text>
                      </View>
                    )}

                    <View
                      style={[
                        styles.bubble,
                        isSent ? styles.bubbleSent : styles.bubbleReceived,
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          isSent
                            ? styles.bubbleTextSent
                            : styles.bubbleTextReceived,
                        ]}
                      >
                        {msg.text}
                      </Text>
                    </View>

                    {/* Meta row: location + time */}
                    <View
                      style={[
                        styles.bubbleMeta,
                        isSent
                          ? styles.bubbleMetaSent
                          : styles.bubbleMetaReceived,
                      ]}
                    >
                      {isSent && msg.hasLocation && (
                        <View style={styles.locationPill}>
                          <MaterialIcons
                            name="location-on"
                            size={11}
                            color="#f27f0d"
                          />
                          <Text style={styles.locationPillText}>GPS</Text>
                        </View>
                      )}
                      <Text style={styles.timeText}>
                        {formatTime(msg.timestamp)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* ── Compose panel ── */}
          <View style={styles.compose}>
            {/* Options row: GPS + urgency chips */}
            <View style={styles.composeOptions}>
              {/* GPS pill */}
              <Pressable
                style={[styles.gpsPill, attachGps && styles.gpsPillActive]}
                onPress={() => setAttachGps((v) => !v)}
              >
                <MaterialIcons
                  name="location-on"
                  size={14}
                  color={attachGps ? "#f27f0d" : "#8a7560"}
                />
                <Text
                  style={[
                    styles.gpsPillText,
                    attachGps && styles.gpsPillTextActive,
                  ]}
                >
                  {attachGps
                    ? gps.status === "ready"
                      ? `${gps.coords.latitude.toFixed(4)}, ${gps.coords.longitude.toFixed(4)}`
                      : gps.status === "denied"
                        ? "GPS denied"
                        : gps.status === "error"
                          ? "GPS error"
                          : "Acquiring…"
                    : "GPS off"}
                </Text>
              </Pressable>

              {/* Urgency chips */}
              <View style={styles.urgencyRow}>
                {URGENCY_OPTIONS.map((opt) => {
                  const active = urgency === opt;
                  const isCrit = opt === "Critical";
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setUrgency(opt)}
                      style={[
                        styles.urgencyChip,
                        active &&
                          (isCrit
                            ? styles.urgencyChipActiveCrit
                            : styles.urgencyChipActive),
                        !active && isCrit && styles.urgencyChipBorderCrit,
                      ]}
                    >
                      <Text
                        style={[
                          styles.urgencyChipText,
                          active && styles.urgencyChipTextActive,
                          !active && isCrit && styles.urgencyChipTextCrit,
                        ]}
                      >
                        {opt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Input row */}
            <View style={styles.inputRow}>
              <TextInput
                value={message}
                onChangeText={(v) => setMessage(v.replace(/\n/g, " "))}
                placeholder="Type your message…"
                placeholderTextColor="#8a7560"
                multiline
                maxLength={180}
                textAlignVertical="top"
                style={styles.input}
              />

              <Pressable
                style={[
                  styles.sendBtn,
                  (sending || gpsAcquiring) && { opacity: 0.6 },
                ]}
                onPress={handleSend}
                disabled={sending || gpsAcquiring}
              >
                {sending || gpsAcquiring ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialIcons name="send" size={22} color="#fff" />
                )}
              </Pressable>
            </View>
            {/* Counter sits below the input only — offset by button width (48) + gap (8) */}
            <Text
              style={[
                styles.charCounter,
                message.length >= 180 && { color: "#d32f2f" },
              ]}
            >
              {message.length}/180
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#fff" },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 24, fontWeight: "700", color: "#181411" },

  // History list
  list: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 6,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  emptyState: { flex: 1, alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#b0a090" },
  emptyHint: { fontSize: 13, color: "#c8bdb0", textAlign: "center" },

  // Bubble row
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  bubbleRowSent: { justifyContent: "flex-end" },
  bubbleRowReceived: { justifyContent: "flex-start" },

  // Column that holds tag + bubble + meta
  bubbleCol: { maxWidth: "78%", gap: 3 },
  bubbleColSent: { alignItems: "flex-end" },
  bubbleColReceived: { alignItems: "flex-start" },

  // Avatar for received messages
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#0ea5e9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18, // lifts it to align with bubble bottom
  },

  // Critical urgency tag
  critTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "#fee2e2",
    alignSelf: "flex-end",
  },
  critTagText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#dc2626",
    letterSpacing: 0.5,
  },

  // Bubble itself
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleSent: {
    backgroundColor: "#f27f0d",
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    backgroundColor: "#f0eeec",
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextSent: { color: "#fff", fontWeight: "500" },
  bubbleTextReceived: { color: "#181411", fontWeight: "500" },

  // Meta row below bubble
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
  },
  bubbleMetaSent: { justifyContent: "flex-end" },
  bubbleMetaReceived: { justifyContent: "flex-start" },

  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "#f27f0d1a",
    borderWidth: 1,
    borderColor: "#f27f0d33",
  },
  locationPillText: {
    color: "#f27f0d",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  timeText: { color: "#a09080", fontSize: 11, fontWeight: "500" },

  // Compose panel
  compose: {
    borderTopWidth: 1,
    borderTopColor: "#e6e0db",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "#fff",
    gap: 8,
  },
  composeOptions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  gpsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e6e0db",
    backgroundColor: "#f8f7f5",
  },
  gpsPillActive: { borderColor: "#f27f0d33", backgroundColor: "#f27f0d0d" },
  gpsPillText: { fontSize: 12, color: "#8a7560", fontWeight: "600" },
  gpsPillTextActive: { color: "#f27f0d" },
  urgencyRow: { flexDirection: "row", gap: 6 },
  urgencyChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f27f0d",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  urgencyChipActive: { backgroundColor: "#f27f0d" },
  urgencyChipActiveCrit: { backgroundColor: "#dc2626", borderColor: "#dc2626" },
  urgencyChipBorderCrit: { borderColor: "#dc2626" },
  urgencyChipText: { fontSize: 12, color: "#f27f0d", fontWeight: "600" },
  urgencyChipTextActive: { color: "#fff" },
  urgencyChipTextCrit: { color: "#dc2626" },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#181411",
    maxHeight: 120,
  },
  charCounter: {
    alignSelf: "flex-end",
    marginTop: 2,
    // Offset by sendBtn width (48) + row gap (8) so the counter
    // appears only beneath the text input, not beneath the button.
    marginRight: 56,
    fontSize: 11,
    color: "#8a7560",
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
});
