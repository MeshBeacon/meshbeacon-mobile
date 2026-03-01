import { MaterialIcons } from "@expo/vector-icons";
import {
    Camera,
    MapView,
    PointAnnotation,
} from "@maplibre/maplibre-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
} from "react";
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
import {
    useLocationAccuracy,
    useLocationCtx,
} from "@/contexts/location-context";
import { useSerial } from "@/contexts/serial-context";
import { useToast } from "@/contexts/toast-context";
import {
    formatCountdown,
    LOCATION_PING_TEXT,
    TRACK_NO_TEXT,
    TRACK_OK_TEXT,
    TRACK_REQ_TEXT,
    TRACKING_INTERVAL_MS,
    useLocationTracking,
} from "@/hooks/use-location-tracking";
import { OFFLINE_STYLE_URL } from "@/hooks/use-offline-map";
import * as Location from "expo-location";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtCoord = (v: string | undefined, dp: number): string => {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? "?" : n.toFixed(dp);
};

const formatTime = (ts: number): string => {
  const d = new Date(ts);
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
  const requestAccuracy = useLocationAccuracy();
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

  // Address book modal
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

  // Compose state
  const [message, setMessage] = useState("");
  const [attachGps, setAttachGps] = useState(true);
  const [trackingActive, setTrackingActive] = useState(false);
  const [sending, setSending] = useState(false);

  // ── Tracking consent state machine ────────────────────────────────────────
  // "idle"       – no request sent yet
  // "requesting" – we sent [TRACK_REQ], waiting for the peer to respond
  // "granted"    – peer sent [TRACK_OK]; peer is now sending us their location
  // "denied"     – peer sent [TRACK_NO]; peer refused to share their location
  const [consentState, setConsentState] = useState<
    "idle" | "requesting" | "granted" | "denied"
  >("idle");

  // True when the peer has sent us a [TRACK_REQ] and we haven't replied yet
  const [hasPendingReq, setHasPendingReq] = useState(false);

  // Watch incoming messages for consent signals and react
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const prev = prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;
    if (messages.length <= prev) return; // no new messages

    // Scan only newly arrived messages (received direction)
    const newMsgs = messages.slice(prev);
    for (const m of newMsgs) {
      if (m.direction !== "received") continue;
      if (m.text === TRACK_REQ_TEXT) {
        // Peer wants us to share our location with them — show consent prompt
        setHasPendingReq(true);
      } else if (m.text === TRACK_OK_TEXT) {
        // Peer agreed to share their location — record consent, wait for their pings
        setConsentState("granted");
        showToast(
          `${contact?.name ?? peerId} accepted location tracking.`,
          "success",
        );
      } else if (m.text === TRACK_NO_TEXT) {
        // Peer declined — stop any active tracking
        setConsentState("denied");
        setTrackingActive(false);
        showToast(
          `${contact?.name ?? peerId} declined location tracking.`,
          "warning",
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Send a consent request to the peer
  const handleRequestTrack = async () => {
    if (status === "disconnected" || status === "error") {
      showToast("Connect to the device first.", "error");
      return;
    }
    try {
      await sendMTalk(peerId, TRACK_REQ_TEXT);
      addSent(TRACK_REQ_TEXT);
      setConsentState("requesting");
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  // Accept an incoming [TRACK_REQ] from peer — we start sending our location to them
  const handleConsentAccept = async () => {
    setHasPendingReq(false);
    try {
      await sendMTalk(peerId, TRACK_OK_TEXT);
      addSent(TRACK_OK_TEXT);
      setTrackingActive(true);
      showToast(
        `You accepted location tracking from ${contact?.name ?? peerId}.`,
        "success",
      );
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  // Decline an incoming [TRACK_REQ] from peer
  const handleConsentDecline = async () => {
    setHasPendingReq(false);
    try {
      await sendMTalk(peerId, TRACK_NO_TEXT);
      addSent(TRACK_NO_TEXT);
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  // Stop tracking and reset consent so a fresh request is needed next time
  const handleStopTracking = () => {
    setTrackingActive(false);
    setConsentState("idle");
  };

  const { secondsLeft, currentIntervalMs } = useLocationTracking({
    active: trackingActive,
    targetPeer: peerId,
    gps,
    serialStatus: status,
    sendMTalk,
    addSent,
    onError: (msg) => showToast(msg, "warning"),
  });

  // Upgrade GPS to Balanced accuracy while tracking is active so the
  // movement-threshold check is precise enough to detect 30 m movement.
  // Releases back to Low (cell-tower) automatically when tracking stops.
  useEffect(() => {
    requestAccuracy(trackingActive ? Location.Accuracy.Balanced : null);
    return () => requestAccuracy(null);
  }, [trackingActive, requestAccuracy]);

  // Auto-stop tracking on disconnect
  useEffect(() => {
    if ((status === "disconnected" || status === "error") && trackingActive) {
      setTrackingActive(false);
      setConsentState("idle");
      showToast("Location tracking stopped: device disconnected.", "warning");
    }
  }, [status, trackingActive, showToast]);

  // Scroll to bottom on new messages
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

  // ── Send ─────────────────────────────────────────────────────────────────
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

            {/* ── Incoming tracking consent request banner ── */}
            {hasPendingReq && (
              <View style={styles.consentBanner}>
                <MaterialIcons
                  name="location-searching"
                  size={16}
                  color="#92400e"
                />
                <Text style={styles.consentBannerText} numberOfLines={2}>
                  {contact?.name ?? peerId} wants to track your location
                </Text>
                <Pressable
                  style={styles.consentDeclineBtn}
                  onPress={handleConsentDecline}
                >
                  <Text style={styles.consentDeclineBtnText}>Decline</Text>
                </Pressable>
                <Pressable
                  style={styles.consentAcceptBtn}
                  onPress={handleConsentAccept}
                >
                  <Text style={styles.consentAcceptBtnText}>Accept</Text>
                </Pressable>
              </View>
            )}

            {/* ── Active tracking banner ── */}
            {trackingActive && (
              <View style={styles.trackingBanner}>
                <MaterialIcons name="my-location" size={14} color="#fff" />
                <Text style={styles.trackingBannerText}>
                  Sharing with {contact?.name ?? peerId} · Next in{" "}
                  {formatCountdown(secondsLeft)}
                  {currentIntervalMs > TRACKING_INTERVAL_MS
                    ? " · Stationary"
                    : ""}
                </Text>
                <Pressable
                  onPress={handleStopTracking}
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
              {messages.length === 0 && (
                <View style={styles.emptyState}>
                  <MaterialIcons name="forum" size={40} color="#d1c5b8" />
                  <Text style={styles.emptyTitle}>No messages yet</Text>
                  <Text style={styles.emptyHint}>
                    Send a message to {contact?.name ?? peerId}
                  </Text>
                </View>
              )}

              {messages.map((msg) => {
                const isSent = msg.direction === "sent";

                // ── Tracking consent system messages ─────────────────────────
                if (
                  msg.text === TRACK_REQ_TEXT ||
                  msg.text === TRACK_OK_TEXT ||
                  msg.text === TRACK_NO_TEXT
                ) {
                  const isReq = msg.text === TRACK_REQ_TEXT;
                  const isOk = msg.text === TRACK_OK_TEXT;
                  const icon: ComponentProps<typeof MaterialIcons>["name"] =
                    isReq
                      ? "location-searching"
                      : isOk
                        ? "check-circle"
                        : "cancel";
                  const label = isReq
                    ? isSent
                      ? "You requested to track their location"
                      : `${contact?.name ?? peerId} wants to track your location`
                    : isOk
                      ? isSent
                        ? "You accepted location sharing"
                        : `${contact?.name ?? peerId} accepted location sharing`
                      : isSent
                        ? "You declined location sharing"
                        : `${contact?.name ?? peerId} declined location sharing`;
                  const cardStyle = isReq
                    ? styles.consentCardReq
                    : isOk
                      ? styles.consentCardOk
                      : styles.consentCardNo;
                  const iconColor = isReq
                    ? "#92400e"
                    : isOk
                      ? "#166534"
                      : "#991b1b";
                  return (
                    <View key={msg.id} style={styles.systemRow}>
                      <View style={[styles.consentCard, cardStyle]}>
                        <MaterialIcons
                          name={icon}
                          size={16}
                          color={iconColor}
                        />
                        <Text
                          style={[styles.consentCardText, { color: iconColor }]}
                        >
                          {label}
                        </Text>
                        <Text style={styles.consentCardTime}>
                          {formatTime(msg.timestamp)}
                        </Text>
                      </View>
                    </View>
                  );
                }

                if (msg.text === LOCATION_PING_TEXT && msg.hasLocation) {
                  const hasCoords = !!(msg.lat && msg.lng);
                  const coord: [number, number] | null = hasCoords
                    ? [parseFloat(msg.lng!), parseFloat(msg.lat!)]
                    : null;
                  return (
                    <View
                      key={msg.id}
                      style={[
                        styles.bubbleRow,
                        isSent
                          ? styles.bubbleRowSent
                          : styles.bubbleRowReceived,
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
                            styles.mapCard,
                            isSent
                              ? styles.mapCardSent
                              : styles.mapCardReceived,
                          ]}
                        >
                          {coord ? (
                            <View style={styles.mapThumb} pointerEvents="none">
                              <MapView
                                style={StyleSheet.absoluteFillObject}
                                mapStyle={OFFLINE_STYLE_URL}
                                logoEnabled={false}
                                attributionEnabled={false}
                                compassEnabled={false}
                                scrollEnabled={false}
                                zoomEnabled={false}
                                rotateEnabled={false}
                                pitchEnabled={false}
                              >
                                <Camera
                                  defaultSettings={{
                                    centerCoordinate: coord,
                                    zoomLevel: 13,
                                  }}
                                  animationMode="none"
                                />
                                <PointAnnotation
                                  id={`pin-${msg.id}`}
                                  coordinate={coord}
                                >
                                  <View
                                    style={[
                                      styles.mapPinDot,
                                      isSent
                                        ? styles.mapPinDotSent
                                        : styles.mapPinDotReceived,
                                    ]}
                                  />
                                </PointAnnotation>
                              </MapView>
                            </View>
                          ) : (
                            <View style={styles.mapThumbFallback}>
                              <MaterialIcons
                                name="location-off"
                                size={28}
                                color="#a09080"
                              />
                              <Text style={styles.mapThumbFallbackText}>
                                No coordinates
                              </Text>
                            </View>
                          )}
                          <View style={styles.mapCardFooter}>
                            <MaterialIcons
                              name="my-location"
                              size={13}
                              color={isSent ? "#f27f0d" : "#0ea5e9"}
                            />
                            <Text
                              style={[
                                styles.mapCardLabel,
                                { color: isSent ? "#f27f0d" : "#0ea5e9" },
                              ]}
                            >
                              Location Update
                            </Text>
                            {coord && (
                              <Text style={styles.mapCardCoords}>
                                {`${fmtCoord(msg.lat, 5)}, ${fmtCoord(msg.lng, 5)}`}
                              </Text>
                            )}
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
                          {isSent && msg.deliveryStatus && (
                            <MaterialIcons
                              name={
                                msg.deliveryStatus === "delivered"
                                  ? "done-all"
                                  : "done"
                              }
                              size={13}
                              color={
                                msg.deliveryStatus === "delivered"
                                  ? "#0ea5e9"
                                  : "#a09080"
                              }
                            />
                          )}
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
                        <Text style={styles.timeText}>
                          {formatTime(msg.timestamp)}
                        </Text>
                        {isSent && msg.deliveryStatus && (
                          <MaterialIcons
                            name={
                              msg.deliveryStatus === "delivered"
                                ? "done-all"
                                : "done"
                            }
                            size={13}
                            color={
                              msg.deliveryStatus === "delivered"
                                ? "#0ea5e9"
                                : "#a09080"
                            }
                          />
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* ── Compose panel ── */}
            <View style={styles.compose}>
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

                {/* Location-tracking toggle — consent-gated */}
                <Pressable
                  style={[
                    styles.trackPill,
                    trackingActive && styles.trackPillActive,
                    consentState === "requesting" && styles.trackPillRequesting,
                    consentState === "denied" && styles.trackPillDenied,
                  ]}
                  onPress={() => {
                    if (trackingActive) {
                      handleStopTracking();
                    } else if (consentState === "granted") {
                      setTrackingActive(true);
                    } else {
                      // idle or denied — (re-)request consent
                      setConsentState("idle");
                      handleRequestTrack();
                    }
                  }}
                >
                  <MaterialIcons
                    name={
                      trackingActive
                        ? "my-location"
                        : consentState === "requesting"
                          ? "pending"
                          : consentState === "denied"
                            ? "block"
                            : "location-searching"
                    }
                    size={14}
                    color={
                      trackingActive
                        ? "#0ea5e9"
                        : consentState === "requesting"
                          ? "#92400e"
                          : consentState === "denied"
                            ? "#991b1b"
                            : "#8a7560"
                    }
                  />
                  <Text
                    style={[
                      styles.trackPillText,
                      trackingActive && styles.trackPillTextActive,
                      consentState === "requesting" &&
                        styles.trackPillTextRequesting,
                      consentState === "denied" && styles.trackPillTextDenied,
                    ]}
                  >
                    {trackingActive
                      ? `Sharing · ${formatCountdown(secondsLeft)}`
                      : consentState === "requesting"
                        ? "Awaiting consent…"
                        : consentState === "denied"
                          ? "Declined · Retry"
                          : consentState === "granted"
                            ? "Share Back"
                            : "Request Track"}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.inputRow}>
                <TextInput
                  value={message}
                  onChangeText={(v) => setMessage(v.replace(/\n/g, " "))}
                  placeholder={`Message ${contact?.name ?? peerId}…`}
                  placeholderTextColor="#8a7560"
                  multiline
                  maxLength={180}
                  textAlignVertical="top"
                  style={styles.input}
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

  // Tracking banner
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
  },
  trackingStop: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Incoming tracking consent request banner (amber)
  consentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fef3c7",
    borderBottomWidth: 1,
    borderBottomColor: "#fde68a",
  },
  consentBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#92400e",
    lineHeight: 16,
  },
  consentDeclineBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fca5a5",
    backgroundColor: "#fee2e2",
  },
  consentDeclineBtnText: { fontSize: 12, fontWeight: "700", color: "#991b1b" },
  consentAcceptBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#16a34a",
  },
  consentAcceptBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },

  // Consent system message bubbles in chat history
  systemRow: { alignItems: "center", paddingVertical: 4 },
  consentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: "85%",
  },
  consentCardReq: { backgroundColor: "#fef3c7", borderColor: "#fde68a" },
  consentCardOk: { backgroundColor: "#dcfce7", borderColor: "#bbf7d0" },
  consentCardNo: { backgroundColor: "#fee2e2", borderColor: "#fecaca" },
  consentCardText: { flex: 1, fontSize: 12, fontWeight: "600" },
  consentCardTime: { fontSize: 10, color: "#a09080", fontWeight: "500" },

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

  // Location map thumbnail
  mapCard: {
    width: 240,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
  },
  mapCardSent: {
    borderColor: "#f27f0d33",
    borderBottomRightRadius: 4,
  },
  mapCardReceived: {
    borderColor: "#0ea5e933",
    borderBottomLeftRadius: 4,
  },
  mapThumb: {
    width: 240,
    height: 160,
    backgroundColor: "#e8e0d8",
  },
  mapThumbFallback: {
    width: 240,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f1ec",
    gap: 6,
  },
  mapThumbFallbackText: {
    fontSize: 12,
    color: "#8a7560",
  },
  mapCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  mapCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  mapCardCoords: {
    fontSize: 10,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    width: "100%" as const,
  },
  mapPinDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: "#fff",
  },
  mapPinDotSent: { backgroundColor: "#f27f0d" },
  mapPinDotReceived: { backgroundColor: "#0ea5e9" },
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
  composeOptions: { flexDirection: "row", alignItems: "center" },
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
  trackPillRequesting: {
    borderColor: "#92400e33",
    backgroundColor: "#fef3c70d",
  },
  trackPillDenied: { borderColor: "#991b1b33", backgroundColor: "#fee2e20d" },
  trackPillText: { fontSize: 12, color: "#8a7560", fontWeight: "600" },
  trackPillTextActive: { color: "#0ea5e9" },
  trackPillTextRequesting: { color: "#92400e" },
  trackPillTextDenied: { color: "#991b1b" },
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
