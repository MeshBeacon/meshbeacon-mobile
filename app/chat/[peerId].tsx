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
  const {
    getMessages,
    addSent: storAddSent,
    markRead,
    markFailed,
    markRetrying,
  } = useChatStoreCtx();
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

  // ── Bounded auto-retry for delivery receipts ─────────────────────────────
  // MTALK is fire-and-forget at the radio layer -- a lost packet or a lost
  // CDK:MACK receipt on the way back otherwise leaves a message stuck in
  // "sent" forever with no feedback. Wait for each MID, and if no CDK:MACK
  // (markDelivered) has arrived, resend the same MID once with backoff
  // before giving up and surfacing a manual resend.
  //
  // Tuned to resend LESS often (was up to 2 automatic resends starting at
  // 5s): on a multi-hop mesh the round trip for an ACK can easily take
  // longer than 5s, so firing that early was mostly resending messages
  // that were already on their way to being delivered -- doubling airtime/
  // battery use across the mesh for no benefit (and, until the firmware
  // de-duped repeated MIDs on receive, could show the same message twice
  // on the recipient's screen). Total time-to-"failed" is barely changed
  // (27s vs 25s) so the user-visible UX (a "retrying" badge appears, then
  // either "delivered" or a tap-to-resend prompt) is effectively the same.
  const RETRY_DELAYS_MS = [9000, 18000];
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const retryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const clearRetryTimer = useCallback((mid: string) => {
    const timer = retryTimers.current.get(mid);
    if (timer) {
      clearTimeout(timer);
      retryTimers.current.delete(mid);
    }
  }, []);

  const armRetry = useCallback(
    (
      mid: string,
      text: string,
      location: { latitude: number; longitude: number } | undefined,
      step = 0,
    ) => {
      clearRetryTimer(mid);
      const timer = setTimeout(async () => {
        const current = messagesRef.current.find((m) => m.mid === mid);
        if (!current || current.deliveryStatus === "delivered") {
          retryTimers.current.delete(mid);
          return;
        }
        if (step < RETRY_DELAYS_MS.length - 1) {
          markRetrying(mid);
          try {
            await sendMTalk(peerId, text, location, mid);
          } catch {
            // Ignore -- next scheduled check will try again or give up.
          }
          armRetry(mid, text, location, step + 1);
        } else {
          markFailed(mid);
          retryTimers.current.delete(mid);
          showToast(
            "Message couldn't be delivered. Tap it to resend.",
            "warning",
          );
        }
      }, RETRY_DELAYS_MS[step]);
      retryTimers.current.set(mid, timer);
    },
    [clearRetryTimer, markFailed, markRetrying, peerId, sendMTalk, showToast],
  );

  // Clear all pending retry timers on unmount.
  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Resume any messages left stuck in "retrying" from a previous mount of
  // this screen. Unmounting cancels pending timers (above) to avoid leaks,
  // but that means navigating away mid-retry and coming back later left the
  // message permanently parked at "retrying" with no timer ever left to
  // resolve it to "delivered" or "failed" -- the spinner would then spin
  // forever unless a late CDK:MACK happened to arrive. Re-arm a fresh bounded
  // retry (from step 0) for any such orphaned message on mount.
  useEffect(() => {
    for (const msg of messagesRef.current) {
      if (
        msg.mid &&
        msg.deliveryStatus === "retrying" &&
        !retryTimers.current.has(msg.mid)
      ) {
        const location =
          msg.hasLocation && msg.lat && msg.lng
            ? { latitude: parseFloat(msg.lat), longitude: parseFloat(msg.lng) }
            : undefined;
        armRetry(msg.mid, msg.text, location, 0);
      }
    }
    // Intentionally run only once on mount -- subsequent "retrying" messages
    // are already tracked by the timer that put them in that state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Manual resend for a message whose auto-retry window gave up. */
  const handleResend = useCallback(
    (msg: ReturnType<typeof getMessages>[number]) => {
      if (!msg.mid) return;
      const location =
        msg.hasLocation && msg.lat && msg.lng
          ? { latitude: parseFloat(msg.lat), longitude: parseFloat(msg.lng) }
          : undefined;
      markRetrying(msg.mid);
      sendMTalk(peerId, msg.text, location, msg.mid).catch((err) => {
        showToast((err as Error).message, "error");
      });
      armRetry(msg.mid, msg.text, location, 0);
    },
    [armRetry, markRetrying, peerId, sendMTalk, showToast],
  );

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
      armRetry(mid, message.trim(), location, 0);
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
                // On the very first layout pass after navigating into a
                // thread, the ScrollView's content height isn't known yet
                // when the mount-time scrollToEnd() (below) fires, so that
                // call can be a no-op during slower navigation transitions.
                // This fires reliably once real content height is measured,
                // so use it to guarantee the initial landing position.
                if (!initialScrollDone.current) {
                  scrollRef.current?.scrollToEnd({ animated: false });
                  initialScrollDone.current = true;
                } else if (keyboardVisible.current) {
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
                        {msg.mid && msg.deliveryStatus === "failed" ? (
                          <Pressable
                            onPress={() => handleResend(msg)}
                            hitSlop={8}
                            accessibilityLabel="Delivery failed, tap to resend"
                          >
                            <MaterialIcons
                              name="error-outline"
                              size={14}
                              color="#c0392b"
                            />
                          </Pressable>
                        ) : msg.mid && msg.deliveryStatus === "retrying" ? (
                          <ActivityIndicator
                            size="small"
                            color="#a09080"
                            style={styles.retryingSpinner}
                            accessibilityLabel="Resending message"
                          />
                        ) : (
                          msg.mid && (
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
                          )
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
  retryingSpinner: { transform: [{ scale: 0.65 }] },
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
