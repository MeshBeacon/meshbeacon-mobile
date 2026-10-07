import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { SerialStatusBanner } from "@/components/serial-status-banner";
import { useAddressBookCtx } from "@/contexts/address-book-context";
import { useChatStoreCtx } from "@/contexts/chat-store-context";
import { useLocationCtx } from "@/contexts/location-context";
import { useSerial } from "@/contexts/serial-context";
import { useToast } from "@/contexts/toast-context";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtCoord = (v: string | undefined, dp: number): string => {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? "?" : n.toFixed(dp);
};

const formatTime = (ts: number | undefined): string => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return isToday
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
};

/** 4-character base-36 random string used as a delivery-receipt message ID. */
const makeMid = (): string => Math.random().toString(36).slice(2, 6);

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChatThreadScreen() {
  const { peerId } = useLocalSearchParams<{ peerId: string }>();
  const router = useRouter();

  const { status, sendMTalk } = useSerial();
  const insets = useSafeAreaInsets();
  const { getMessages, addSent: storAddSent, markRead } = useChatStoreCtx();
  const { showToast } = useToast();
  const gps = useLocationCtx();
  const { contacts, addContact, removeContact, hasContact } =
    useAddressBookCtx();

  // Mark thread as read on mount
  useEffect(() => {
    markRead(peerId);
  }, [peerId, markRead]);

  // Get messages for this peer
  const messages = useMemo(() => getMessages(peerId), [getMessages, peerId]);

  // Bound addSent for this peer
  const addSent = useCallback(
    (
      text: string,
      location?: { latitude: number; longitude: number },
      mid?: string,
    ) => storAddSent(peerId, text, location, mid),
    [storAddSent, peerId],
  );

  const scrollRef = useRef<ScrollView>(null);
  const initialScrollDone = useRef(false);
  const keyboardVisible = useRef(false);

  // Contact info for this peer
  const contact = contacts.find((c) => c.duckId === peerId);

  // ── Address book modal ────────────────────────────────────────────────────
  const [abOpen, setAbOpen] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState("");
  const [contactIdDraft, setContactIdDraft] = useState("");

  const openAddContact = (prefillId = "") => {
    setContactNameDraft("");
    setContactIdDraft(prefillId.toUpperCase());
    setAddingContact(true);
  };

  const commitAddContact = () => {
    try {
      addContact(contactNameDraft, contactIdDraft);
      setAddingContact(false);
      setContactNameDraft("");
      setContactIdDraft("");
      showToast(`${contactNameDraft.trim()} saved to address book.`, "success");
    } catch (err) {
      showToast((err as Error).message, "warning");
    }
  };

  // ── Compose state ─────────────────────────────────────────────────────────
  const [message, setMessage] = useState("");
  const [attachGps, setAttachGps] = useState(true);
  const [sending, setSending] = useState(false);

  // ── Scroll to bottom on new messages ─────────────────────────────────────
  useEffect(() => {
    if (!messages) return;
    const animated = initialScrollDone.current;
    const delay = keyboardVisible.current ? 150 : 80;
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated });
      initialScrollDone.current = true;
    }, delay);
  }, [messages.length]);

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

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!message.trim()) {
      showToast("Please type a message before sending.", "warning");
      return;
    }
    if (status === "disconnected" || status === "error") {
      showToast("Connect to the device first.", "error");
      return;
    }
    setSending(true);
    try {
      const location =
        attachGps && gps.status === "ready" ? gps.coords : undefined;
      const mid = makeMid();
      await sendMTalk(peerId, message.trim(), location, mid);
      addSent(message.trim(), location, mid);
      setMessage("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={styles.container}>
            {/* ── Header ── */}
            <View style={styles.header}>
              <Pressable style={styles.backBtn} onPress={() => router.back()}>
                <MaterialIcons name="arrow-back" size={24} color="#181411" />
              </Pressable>
              <View style={styles.headerInfo}>
                <Text style={styles.headerPeerId} numberOfLines={1}>
                  {contact?.name ?? peerId}
                </Text>
                {contact?.name && (
                  <Text style={styles.headerPeerSub}>{peerId}</Text>
                )}
              </View>
              <Pressable
                style={styles.abBtn}
                onPress={() => setAbOpen(true)}
                accessibilityLabel="Address book"
              >
                <MaterialIcons
                  name={hasContact(peerId) ? "person" : "person-add"}
                  size={22}
                  color="#f27f0d"
                />
              </Pressable>
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
              {messages.length === 0 && (
                <View style={styles.emptyState}>
                  <MaterialIcons
                    name="chat-bubble-outline"
                    size={40}
                    color="#d1c5b8"
                  />
                  <Text style={styles.emptyTitle}>No messages yet</Text>
                  <Text style={styles.emptyHint}>Start the conversation</Text>
                </View>
              )}

              {messages.map((msg) => {
                const isSent = msg.direction === "sent";
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.bubbleRow,
                      isSent ? styles.bubbleRowSent : styles.bubbleRowReceived,
                    ]}
                  >
                    {!isSent && (
                      <View style={styles.avatar}>
                        <MaterialIcons name="person" size={14} color="#fff" />
                      </View>
                    )}

                    <View
                      style={[
                        styles.bubbleCol,
                        isSent
                          ? styles.bubbleColSent
                          : styles.bubbleColReceived,
                      ]}
                    >
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

                      <View
                        style={[
                          styles.bubbleMeta,
                          isSent
                            ? styles.bubbleMetaSent
                            : styles.bubbleMetaReceived,
                        ]}
                      >
                        {msg.encrypted !== undefined && (
                          <MaterialIcons
                            name={msg.encrypted ? "lock" : "lock-open"}
                            size={12}
                            color={msg.encrypted ? "#2e7d32" : "#b45309"}
                            accessibilityLabel={
                              msg.encrypted
                                ? "Encrypted"
                                : "Sent without encryption"
                            }
                          />
                        )}
                        {msg.hasLocation && (
                          <View style={styles.locationPill}>
                            <MaterialIcons
                              name="location-on"
                              size={11}
                              color="#f27f0d"
                            />
                            {!isSent && msg.lat && msg.lng ? (
                              <Text style={styles.locationPillText}>
                                {`${fmtCoord(msg.lat, 4)}, ${fmtCoord(msg.lng, 4)}`}
                              </Text>
                            ) : (
                              <Text style={styles.locationPillText}>GPS</Text>
                            )}
                          </View>
                        )}
                        {msg.mid && (
                          <MaterialIcons
                            name={
                              msg.deliveryStatus === "delivered"
                                ? "done-all"
                                : "done"
                            }
                            size={13}
                            color={
                              msg.deliveryStatus === "delivered"
                                ? "#f27f0d"
                                : "#a09080"
                            }
                          />
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

            {/* ── Compose ── */}
            <View style={styles.compose}>
              {/* GPS pill */}
              <View style={styles.composeOptions}>
                <Pressable
                  style={[styles.gpsPill, attachGps && styles.gpsPillActive]}
                  onPress={() => setAttachGps((v) => !v)}
                >
                  <MaterialIcons
                    name="location-on"
                    size={13}
                    color={attachGps ? "#f27f0d" : "#8a7560"}
                  />
                  <Text
                    style={[
                      styles.gpsPillText,
                      attachGps && styles.gpsPillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {attachGps
                      ? gps.status === "ready"
                        ? `${gps.coords.latitude.toFixed(4)}, ${gps.coords.longitude.toFixed(4)}`
                        : "Acquiring…"
                      : "GPS Off"}
                  </Text>
                </Pressable>
              </View>

              {/* Input row */}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Message…"
                  placeholderTextColor="#8a7560"
                  multiline
                  maxLength={180}
                  returnKeyType="default"
                />
                <Pressable
                  style={styles.sendBtn}
                  onPress={handleSend}
                  disabled={sending || !message.trim()}
                >
                  {sending ? (
                    <ActivityIndicator size={20} color="#fff" />
                  ) : (
                    <MaterialIcons name="send" size={20} color="#fff" />
                  )}
                </Pressable>
              </View>
              <Text style={styles.charCounter}>{message.length}/180</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── Address Book Modal ── */}
      <Modal
        visible={abOpen}
        animationType="slide"
        onRequestClose={() => setAbOpen(false)}
      >
        <View
          style={[
            styles.abModal,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <View style={styles.abHeader}>
            <MaterialIcons name="contacts" size={20} color="#f27f0d" />
            <Text style={styles.abTitle}>Address Book</Text>
            <Pressable
              style={styles.abCloseBtn}
              onPress={() => {
                setAbOpen(false);
                setAddingContact(false);
              }}
            >
              <MaterialIcons name="close" size={22} color="#181411" />
            </Pressable>
          </View>

          {addingContact ? (
            <View style={styles.abAddForm}>
              <Text style={styles.abAddFormTitle}>New Contact</Text>
              <TextInput
                autoFocus
                value={contactNameDraft}
                onChangeText={setContactNameDraft}
                placeholder="Name"
                placeholderTextColor="#8a7560"
                returnKeyType="next"
                style={styles.abInput}
              />
              <TextInput
                value={contactIdDraft}
                onChangeText={(v) => setContactIdDraft(v.toUpperCase())}
                placeholder="Duck ID (8 chars)"
                placeholderTextColor="#8a7560"
                maxLength={8}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={commitAddContact}
                style={[styles.abInput, styles.abInputMono]}
              />
              <View style={styles.abFormActions}>
                <Pressable
                  style={styles.abCancelBtn}
                  onPress={() => {
                    setAddingContact(false);
                    setContactNameDraft("");
                    setContactIdDraft("");
                  }}
                >
                  <Text style={styles.abCancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.abSaveBtn,
                    (contactNameDraft.trim().length === 0 ||
                      contactIdDraft.length !== 8) && { opacity: 0.4 },
                  ]}
                  disabled={
                    contactNameDraft.trim().length === 0 ||
                    contactIdDraft.length !== 8
                  }
                  onPress={commitAddContact}
                >
                  <MaterialIcons name="check" size={16} color="#fff" />
                  <Text style={styles.abSaveBtnText}>Save Contact</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.abToolbar}>
              {hasContact(peerId) ? (
                <>
                  <View style={styles.abCurrentContact}>
                    <View style={styles.abCurrentAvatar}>
                      <Text style={styles.abCurrentAvatarText}>
                        {contact?.name.trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.abCurrentName}>{contact?.name}</Text>
                      <Text style={styles.abCurrentId}>{peerId}</Text>
                    </View>
                    <Pressable
                      style={styles.abDeleteBtn}
                      onPress={() => {
                        if (contact) removeContact(contact.id);
                        setAbOpen(false);
                      }}
                    >
                      <MaterialIcons
                        name="delete-outline"
                        size={20}
                        color="#e53e3e"
                      />
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  style={styles.abNewBtn}
                  onPress={() => openAddContact(peerId)}
                >
                  <MaterialIcons name="person-add" size={16} color="#f27f0d" />
                  <Text style={styles.abNewBtnText}>Save {peerId}</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.abDivider} />

          {/* All contacts list */}
          <ScrollView
            contentContainerStyle={styles.abList}
            showsVerticalScrollIndicator={false}
          >
            {contacts.length === 0 ? (
              <View style={styles.abEmpty}>
                <MaterialIcons name="contacts" size={48} color="#d1c5b8" />
                <Text style={styles.abEmptyTitle}>No contacts yet</Text>
                <Text style={styles.abEmptyHint}>
                  Save duck IDs you frequently chat with
                </Text>
              </View>
            ) : (
              contacts.map((c) => (
                <View key={c.id} style={styles.abContactRow}>
                  <View style={styles.abAvatar}>
                    <Text style={styles.abAvatarText}>
                      {c.name.trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.abContactInfo}>
                    <Text style={styles.abContactName}>{c.name}</Text>
                    <Text style={styles.abContactId}>{c.duckId}</Text>
                  </View>
                  <Pressable
                    style={styles.abDeleteBtn}
                    onPress={() => removeContact(c.id)}
                  >
                    <MaterialIcons
                      name="delete-outline"
                      size={20}
                      color="#e53e3e"
                    />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#fff" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
    gap: 4,
  },
  backBtn: { padding: 8 },
  headerInfo: { flex: 1, paddingLeft: 4 },
  headerPeerId: {
    fontSize: 18,
    fontWeight: "700",
    color: "#181411",
    letterSpacing: 0.3,
  },
  headerPeerSub: {
    fontSize: 11,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  abBtn: { padding: 8 },

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

  // Bubble
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  bubbleRowSent: { justifyContent: "flex-end" },
  bubbleRowReceived: { justifyContent: "flex-start" },
  bubbleCol: { maxWidth: "78%", gap: 3 },
  bubbleColSent: { alignItems: "flex-end" },
  bubbleColReceived: { alignItems: "flex-start" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#0ea5e9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleSent: { backgroundColor: "#f27f0d", borderBottomRightRadius: 4 },
  bubbleReceived: { backgroundColor: "#f0eeec", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextSent: { color: "#fff", fontWeight: "500" },
  bubbleTextReceived: { color: "#181411", fontWeight: "500" },
  bubbleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
  },
  bubbleMetaSent: { justifyContent: "flex-end" },
  bubbleMetaReceived: { justifyContent: "flex-start" },
  timeText: { color: "#a09080", fontSize: 11, fontWeight: "500" },

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

  // Compose
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
    paddingVertical: 2,
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
  gpsPillText: {
    fontSize: 12,
    color: "#8a7560",
    fontWeight: "600",
    maxWidth: 200,
  },
  gpsPillTextActive: { color: "#f27f0d" },
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

  // Address Book Modal
  abModal: { flex: 1, backgroundColor: "#fff" },
  abHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
  },
  abTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: "#181411" },
  abCloseBtn: { padding: 4 },
  abToolbar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  abCurrentContact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#fdf9f5",
    borderWidth: 1,
    borderColor: "#f27f0d33",
  },
  abCurrentAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  abCurrentAvatarText: { fontSize: 19, fontWeight: "700", color: "#fff" },
  abCurrentName: { fontSize: 16, fontWeight: "700", color: "#181411" },
  abCurrentId: {
    fontSize: 12,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
  },
  abNewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f27f0d33",
    backgroundColor: "#fff5ea",
  },
  abNewBtnText: { fontSize: 14, fontWeight: "700", color: "#f27f0d" },
  abAddForm: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#fdf9f5",
    borderWidth: 1,
    borderColor: "#f27f0d33",
    gap: 10,
  },
  abAddFormTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#181411",
    marginBottom: 2,
  },
  abInput: {
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#181411",
    backgroundColor: "#fff",
  },
  abInputMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    letterSpacing: 1,
    fontWeight: "700",
  },
  abFormActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  abCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e6e0db",
    alignItems: "center",
    justifyContent: "center",
  },
  abCancelBtnText: { fontSize: 14, fontWeight: "600", color: "#8a7560" },
  abSaveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#f27f0d",
  },
  abSaveBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  abDivider: { height: 1, backgroundColor: "#f0eeec", marginTop: 4 },
  abList: { padding: 16, gap: 10, flexGrow: 1 },
  abEmpty: { flex: 1, alignItems: "center", paddingTop: 60, gap: 12 },
  abEmptyTitle: { fontSize: 17, fontWeight: "600", color: "#b0a090" },
  abEmptyHint: {
    fontSize: 14,
    color: "#c8bdb0",
    textAlign: "center",
    lineHeight: 20,
  },
  abContactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#fdf9f5",
    borderWidth: 1,
    borderColor: "#f0eeec",
  },
  abAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  abAvatarText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  abContactInfo: { flex: 1, gap: 2 },
  abContactName: { fontSize: 15, fontWeight: "700", color: "#181411" },
  abContactId: {
    fontSize: 12,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  abDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff5f5",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    justifyContent: "center",
  },
});
