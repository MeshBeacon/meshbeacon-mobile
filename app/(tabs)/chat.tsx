import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { SerialStatusBanner } from "@/components/serial-status-banner";
import { useAddressBookCtx } from "@/contexts/address-book-context";
import { useChatStoreCtx } from "@/contexts/chat-store-context";
import { useLocationCtx } from "@/contexts/location-context";
import { useSerial } from "@/contexts/serial-context";
import { useToast } from "@/contexts/toast-context";
import {
    formatCountdown,
    LOCATION_PING_TEXT,
    useLocationTracking,
} from "@/hooks/use-location-tracking";

export default function ChatScreen() {
  const { status, sendMTalk } = useSerial();
  const { messages, loaded, targetPeer, setTargetPeer, addSent } =
    useChatStoreCtx();
  const { showToast } = useToast();
  const gps = useLocationCtx();

  const { contacts, addContact, removeContact, hasContact } =
    useAddressBookCtx();

  const scrollRef = useRef<ScrollView>(null);
  const initialScrollDone = useRef(false);
  const keyboardVisible = useRef(false);

  // Current peer's saved name (if any)
  const currentContactName = contacts.find(
    (c) => c.duckId === targetPeer,
  )?.name;

  // Address book modal state
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

  const [message, setMessage] = useState("");
  const [attachGps, setAttachGps] = useState(true);
  const [trackingActive, setTrackingActive] = useState(false);
  const [sending, setSending] = useState(false);

  const { secondsLeft } = useLocationTracking({
    active: trackingActive,
    targetPeer,
    gps,
    serialStatus: status,
    sendMTalk,
    addSent,
    onError: (msg) => showToast(msg, "warning"),
  });

  // Auto-stop tracking if the device disconnects
  useEffect(() => {
    if ((status === "disconnected" || status === "error") && trackingActive) {
      setTrackingActive(false);
      showToast("Location tracking stopped: device disconnected.", "warning");
    }
  }, [status, trackingActive, showToast]);

  // ── Peer ID editor ────────────────────────────────────────────────────────
  const [editingPeer, setEditingPeer] = useState(false);
  const [peerDraft, setPeerDraft] = useState("");

  const openPeerEdit = () => {
    setPeerDraft(targetPeer);
    setEditingPeer(true);
  };

  const commitPeerEdit = () => {
    const trimmed = peerDraft.trim().toUpperCase();
    if (trimmed.length !== 8) {
      showToast("Duck ID must be exactly 8 characters.", "warning");
      return;
    }
    setTargetPeer(trimmed);
    setEditingPeer(false);
  };

  const cancelPeerEdit = () => {
    setEditingPeer(false);
  };

  // ── Scroll behaviour identical to messages.tsx ────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    const animated = initialScrollDone.current;
    const delay = keyboardVisible.current ? 150 : 80;
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated });
      initialScrollDone.current = true;
    }, delay);
  }, [messages.length, loaded]);

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

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!message.trim()) {
      showToast("Please type a message before sending.", "warning");
      return;
    }
    if (!targetPeer || targetPeer.length !== 8) {
      showToast(
        "Set the 8-character duck ID of your chat partner first.",
        "warning",
      );
      openPeerEdit();
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
      await sendMTalk(targetPeer, message.trim(), location);
      addSent(message.trim(), location);
      setMessage("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

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
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Direct Chat</Text>
              <MaterialIcons name="swap-horiz" size={20} color="#f27f0d" />
            </View>
          </View>

          {/* ── Peer selector ── */}
          {editingPeer ? (
            <View style={styles.peerEditRow}>
              <MaterialIcons name="cell-tower" size={16} color="#f27f0d" />
              <TextInput
                autoFocus
                value={peerDraft}
                onChangeText={(v) => setPeerDraft(v.toUpperCase())}
                placeholder="Duck ID (8 chars)"
                placeholderTextColor="#8a7560"
                maxLength={8}
                autoCapitalize="characters"
                style={styles.peerInput}
              />
              <Text
                style={[
                  styles.peerCounter,
                  peerDraft.length === 8 && styles.peerCounterOk,
                ]}
              >
                {peerDraft.length}/8
              </Text>
              <Pressable
                onPress={commitPeerEdit}
                style={[
                  styles.peerBtn,
                  peerDraft.length !== 8 && { opacity: 0.4 },
                ]}
                disabled={peerDraft.length !== 8}
              >
                <MaterialIcons name="check" size={18} color="#fff" />
              </Pressable>
              <Pressable onPress={cancelPeerEdit} style={styles.peerBtnCancel}>
                <MaterialIcons name="close" size={18} color="#8a7560" />
              </Pressable>
              <Pressable
                style={styles.peerBtnAb}
                onPress={() => { setAbOpen(true); setAddingContact(false); }}
                accessibilityLabel="Open address book"
              >
                <MaterialIcons name="contacts" size={18} color="#f27f0d" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.peerRow}>
              <Pressable style={styles.peerRowMain} onPress={openPeerEdit}>
                <MaterialIcons name="cell-tower" size={16} color="#f27f0d" />
                {targetPeer ? (
                  <>
                    <Text style={styles.peerLabel}>To:</Text>
                    <Text style={styles.peerId}>{targetPeer}</Text>
                    {currentContactName && (
                      <Text style={styles.peerContactName}>
                        {currentContactName}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.peerPlaceholder}>
                    Tap to set duck ID…
                  </Text>
                )}
                <MaterialIcons
                  name="edit"
                  size={14}
                  color="#b0a090"
                  style={styles.peerEditIcon}
                />
              </Pressable>
              <Pressable
                style={styles.abOpenBtn}
                onPress={() => setAbOpen(true)}
                accessibilityLabel="Open address book"
              >
                <MaterialIcons name="contacts" size={22} color="#f27f0d" />
              </Pressable>
            </View>
          )}

          <SerialStatusBanner />

          {/* ── Tracking active banner ── */}
          {trackingActive && (
            <View style={styles.trackingBanner}>
              <MaterialIcons name="my-location" size={14} color="#fff" />
              <Text style={styles.trackingBannerText}>
                Tracking {targetPeer} · Next in {formatCountdown(secondsLeft)}
              </Text>
              <Pressable
                onPress={() => setTrackingActive(false)}
                style={styles.trackingStop}
              >
                <MaterialIcons name="stop" size={14} color="#fff" />
              </Pressable>
            </View>
          )}

          {/* ── Chat history ── */}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (keyboardVisible.current)
                scrollRef.current?.scrollToEnd({ animated: true });
            }}
          >
            {loaded && messages.length === 0 && (
              <View style={styles.emptyState}>
                <MaterialIcons name="forum" size={40} color="#d1c5b8" />
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptyHint}>
                  {targetPeer
                    ? `Send a message to ${targetPeer}`
                    : "Set a duck ID above to start chatting"}
                </Text>
              </View>
            )}

            {messages.map((msg) => {
              const isSent = msg.direction === "sent";

              // ── Location-ping card (no text, just coordinates) ────────────
              if (msg.text === LOCATION_PING_TEXT && msg.hasLocation) {
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
                        <MaterialIcons
                          name="cell-tower"
                          size={14}
                          color="#fff"
                        />
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
                          styles.locationCard,
                          isSent
                            ? styles.locationCardSent
                            : styles.locationCardReceived,
                        ]}
                      >
                        <MaterialIcons
                          name="my-location"
                          size={20}
                          color={isSent ? "#f27f0d" : "#0ea5e9"}
                        />
                        <View>
                          <Text style={styles.locationCardLabel}>
                            Location Update
                          </Text>
                          <Text style={styles.locationCardCoords}>
                            {msg.lat && msg.lng
                              ? `${parseFloat(msg.lat).toFixed(5)}, ${parseFloat(msg.lng).toFixed(5)}`
                              : "No coordinates"}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.bubbleMeta,
                          isSent
                            ? styles.bubbleMetaSent
                            : styles.bubbleMetaReceived,
                        ]}
                      >
                        <Text style={styles.timeText}>
                          {formatTime(msg.timestamp)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              }

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
                      {msg.hasLocation && (
                        <View style={styles.locationPill}>
                          <MaterialIcons
                            name="location-on"
                            size={11}
                            color="#f27f0d"
                          />
                          {!isSent && msg.lat && msg.lng ? (
                            <Text style={styles.locationPillText}>
                              {parseFloat(msg.lat).toFixed(4)},
                              {parseFloat(msg.lng).toFixed(4)}
                            </Text>
                          ) : (
                            <Text style={styles.locationPillText}>GPS</Text>
                          )}
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
            {/* Compose options row: GPS pill + Track toggle */}
            <View style={styles.composeOptions}>
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

              {/* Location-tracking toggle */}
              <Pressable
                style={[
                  styles.trackPill,
                  trackingActive && styles.trackPillActive,
                ]}
                onPress={() => {
                  if (!targetPeer || targetPeer.length !== 8) {
                    showToast(
                      "Set the duck ID of your chat partner first.",
                      "warning",
                    );
                    return;
                  }
                  setTrackingActive((v) => !v);
                }}
              >
                <MaterialIcons
                  name={trackingActive ? "my-location" : "location-searching"}
                  size={14}
                  color={trackingActive ? "#0ea5e9" : "#8a7560"}
                />
                <Text
                  style={[
                    styles.trackPillText,
                    trackingActive && styles.trackPillTextActive,
                  ]}
                >
                  {trackingActive
                    ? `Tracking · ${formatCountdown(secondsLeft)}`
                    : "Track"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.inputRow}>
              <TextInput
                value={message}
                onChangeText={(v) => setMessage(v.replace(/\n/g, " "))}
                placeholder={
                  targetPeer ? `Message ${targetPeer}…` : "Set a duck ID first…"
                }
                placeholderTextColor="#8a7560"
                multiline
                maxLength={180}
                textAlignVertical="top"
                style={styles.input}
                editable={!!targetPeer}
              />
              <Pressable
                style={[styles.sendBtn, sending && { opacity: 0.6 }]}
                onPress={handleSend}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialIcons name="send" size={22} color="#fff" />
                )}
              </Pressable>
            </View>
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
    {/* ── Address Book Modal ── */}
      <Modal
        visible={abOpen}
        animationType="slide"
        onRequestClose={() => setAbOpen(false)}
      >
        <SafeAreaView style={styles.abModal} edges={["top", "bottom"]}>
          {/* Header */}
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

          {/* Add-contact form */}
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
              <Pressable
                style={styles.abNewBtn}
                onPress={() => openAddContact()}
              >
                <MaterialIcons name="person-add" size={16} color="#f27f0d" />
                <Text style={styles.abNewBtnText}>New Contact</Text>
              </Pressable>
              {targetPeer &&
                targetPeer.length === 8 &&
                !hasContact(targetPeer) && (
                  <Pressable
                    style={styles.abSaveCurrentBtn}
                    onPress={() => openAddContact(targetPeer)}
                  >
                    <MaterialIcons
                      name="bookmark-add"
                      size={16}
                      color="#0ea5e9"
                    />
                    <Text style={styles.abSaveCurrentText}>
                      Save {targetPeer}
                    </Text>
                  </Pressable>
                )}
            </View>
          )}

          <View style={styles.abDivider} />

          {/* Contact list */}
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
              contacts.map((contact) => (
                <View key={contact.id} style={styles.abContactRow}>
                  <View style={styles.abAvatar}>
                    <Text style={styles.abAvatarText}>
                      {contact.name.trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.abContactInfo}>
                    <Text style={styles.abContactName}>{contact.name}</Text>
                    <Text style={styles.abContactId}>{contact.duckId}</Text>
                  </View>
                  <Pressable
                    style={styles.abChatBtn}
                    onPress={() => {
                      setTargetPeer(contact.duckId);
                      setAbOpen(false);
                      setAddingContact(false);
                    }}
                    accessibilityLabel={`Chat with ${contact.name}`}
                  >
                    <MaterialIcons name="chat" size={16} color="#fff" />
                  </Pressable>
                  <Pressable
                    style={styles.abDeleteBtn}
                    onPress={() => removeContact(contact.id)}
                    accessibilityLabel={`Remove ${contact.name}`}
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
        </SafeAreaView>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#181411" },

  // Peer selector (display mode)
  peerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 4,
    backgroundColor: "#fdf9f5",
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
  },
  peerRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  abOpenBtn: { padding: 10 },
  peerContactName: {
    fontSize: 12,
    color: "#8a7560",
    fontStyle: "italic",
    fontWeight: "500",
  },
  peerLabel: { fontSize: 13, color: "#8a7560", fontWeight: "600" },
  peerId: {
    fontSize: 13,
    fontWeight: "700",
    color: "#181411",
    letterSpacing: 0.5,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  peerPlaceholder: { fontSize: 13, color: "#b0a090", fontStyle: "italic" },
  peerEditIcon: { marginLeft: "auto" },

  // Peer selector (edit mode)
  peerEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fdf9f5",
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d33",
  },
  peerInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#181411",
    borderWidth: 1,
    borderColor: "#f27f0d",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    letterSpacing: 1,
  },
  peerCounter: {
    fontSize: 12,
    color: "#b0a090",
    fontWeight: "600",
    minWidth: 24,
  },
  peerCounterOk: { color: "#22c55e" },
  peerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  peerBtnCancel: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f0eeec",
    alignItems: "center",
    justifyContent: "center",
  },
  peerBtnAb: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#fff5ea",
    borderWidth: 1,
    borderColor: "#f27f0d33",
    alignItems: "center",
    justifyContent: "center",
  },

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

  // Tracking toggle pill
  trackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e6e0db",
    backgroundColor: "#f8f7f5",
    marginLeft: 8,
  },
  trackPillActive: { borderColor: "#0ea5e933", backgroundColor: "#0ea5e90d" },
  trackPillText: { fontSize: 12, color: "#8a7560", fontWeight: "600" },
  trackPillTextActive: { color: "#0ea5e9" },

  // Tracking active banner
  trackingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#0ea5e9",
  },
  trackingBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  trackingStop: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Location-ping card (replaces bubble for 📍 pings)
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  locationCardSent: {
    backgroundColor: "#fff7ee",
    borderColor: "#f27f0d33",
    borderBottomRightRadius: 4,
  },
  locationCardReceived: {
    backgroundColor: "#f0f9ff",
    borderColor: "#0ea5e933",
    borderBottomLeftRadius: 4,
  },
  locationCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#181411",
    letterSpacing: 0.3,
  },
  locationCardCoords: {
    fontSize: 11,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 2,
  },

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

  // ── Address Book Modal ────────────────────────────────────────────────────
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
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  abNewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f27f0d33",
    backgroundColor: "#fff5ea",
  },
  abNewBtnText: { fontSize: 13, fontWeight: "700", color: "#f27f0d" },
  abSaveCurrentBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#0ea5e933",
    backgroundColor: "#f0f9ff",
  },
  abSaveCurrentText: { fontSize: 13, fontWeight: "700", color: "#0ea5e9" },

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

  abEmpty: {
    flex: 1,
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
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
  abChatBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
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
