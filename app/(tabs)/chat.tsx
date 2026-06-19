import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
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
import { useNearbyDucksCtx } from "@/contexts/nearby-ducks-context";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatInboxTime(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function previewText(text: string | undefined): string {
  if (!text) return "";
  return text.length > 50 ? text.slice(0, 50) + "…" : text;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChatInboxScreen() {
  const router = useRouter();
  const { conversations, loaded } = useChatStoreCtx();
  const { contacts, addContact } = useAddressBookCtx();
  const { nearbyDucks } = useNearbyDucksCtx();

  // ── New conversation modal ──────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [peerDraft, setPeerDraft] = useState("");

  const openThread = (peerId: string) => {
    setNewOpen(false);
    setPeerDraft("");
    // Navigate to thread (cast needed until Expo Router re-generates types for app/chat/[peerId].tsx)
    router.push({ pathname: "/chat/[peerId]" as any, params: { peerId } });
  };

  // ── Address-book quick-add inside new-chat modal ────────────────────────
  const [addingContact, setAddingContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactId, setContactId] = useState("");

  const commitAddContact = () => {
    try {
      addContact(contactName, contactId);
      setAddingContact(false);
      setContactName("");
      setContactId("");
    } catch {
      /* ignore — use-address-book shows descriptive errors */
    }
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.container}>
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Nearby</Text>
              <MaterialIcons name="swap-horiz" size={20} color="#f27f0d" />
            </View>
            <Pressable
              style={styles.newBtn}
              onPress={() => setNewOpen(true)}
              accessibilityLabel="New conversation"
            >
              <MaterialIcons name="edit" size={20} color="#f27f0d" />
            </Pressable>
          </View>

          <SerialStatusBanner />

          {/* ── Conversation list ── */}
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {loaded && conversations.length === 0 && (
              <View style={styles.emptyState}>
                <MaterialIcons name="forum" size={48} color="#d1c5b8" />
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptyHint}>
                  Tap the pencil icon to start a new chat
                </Text>
                <Pressable
                  style={styles.emptyBtn}
                  onPress={() => setNewOpen(true)}
                >
                  <MaterialIcons name="add" size={16} color="#fff" />
                  <Text style={styles.emptyBtnText}>New Chat</Text>
                </Pressable>
              </View>
            )}

            {conversations.map((conv) => {
              const contact = contacts.find((c) => c.duckId === conv.peerId);
              const displayName = contact?.name ?? conv.peerId;
              const avatarLetter =
                contact?.name?.trim().charAt(0).toUpperCase() ??
                conv.peerId.charAt(0).toUpperCase();
              const isSent = conv.lastMessage?.direction === "sent";
              const preview = previewText(conv.lastMessage?.text);

              return (
                <Pressable
                  key={conv.peerId}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => openThread(conv.peerId)}
                >
                  {/* Avatar */}
                  <View
                    style={[
                      styles.avatar,
                      contact ? styles.avatarContact : styles.avatarUnknown,
                    ]}
                  >
                    <Text style={styles.avatarText}>{avatarLetter}</Text>
                  </View>

                  {/* Main content */}
                  <View style={styles.rowContent}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {displayName}
                      </Text>
                      {conv.unreadCount > 0 && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>
                            {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.rowTime}>
                        {formatInboxTime(conv.lastMessage?.timestamp)}
                      </Text>
                    </View>
                    <View style={styles.rowBottom}>
                      {isSent && (
                        <MaterialIcons
                          name="reply"
                          size={13}
                          color="#a09080"
                          style={{
                            marginRight: 2,
                            transform: [{ scaleX: -1 }],
                          }}
                        />
                      )}
                      <Text style={styles.rowPreview} numberOfLines={1}>
                        {preview || "No messages yet"}
                      </Text>
                    </View>
                    {contact?.name && (
                      <View style={styles.idPill}>
                        <Text style={styles.idPillText}>{conv.peerId}</Text>
                      </View>
                    )}
                  </View>

                  <MaterialIcons
                    name="chevron-right"
                    size={20}
                    color="#d1c5b8"
                  />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </SafeAreaView>

      {/* ── New Conversation Modal ── */}
      <Modal
        visible={newOpen}
        animationType="slide"
        onRequestClose={() => setNewOpen(false)}
      >
        <SafeAreaView style={styles.modal} edges={["top", "bottom"]}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <MaterialIcons name="edit" size={20} color="#f27f0d" />
            <Text style={styles.modalTitle}>New Conversation</Text>
            <Pressable
              style={styles.modalClose}
              onPress={() => {
                setNewOpen(false);
                setAddingContact(false);
                setPeerDraft("");
              }}
            >
              <MaterialIcons name="close" size={22} color="#181411" />
            </Pressable>
          </View>

          {/* Duck ID input */}
          <View style={styles.modalSection}>
            <Text style={styles.modalLabel}>Enter Duck ID</Text>
            <View style={styles.draftRow}>
              <TextInput
                autoFocus
                value={peerDraft}
                onChangeText={(v) => setPeerDraft(v.toUpperCase())}
                placeholder="8-character Duck ID"
                placeholderTextColor="#8a7560"
                maxLength={8}
                autoCapitalize="characters"
                style={styles.draftInput}
              />
              <Text
                style={[
                  styles.draftCounter,
                  peerDraft.length === 8 && styles.draftCounterOk,
                ]}
              >
                {peerDraft.length}/8
              </Text>
              <Pressable
                style={[
                  styles.draftBtn,
                  peerDraft.length !== 8 && { opacity: 0.4 },
                ]}
                disabled={peerDraft.length !== 8}
                onPress={() => openThread(peerDraft)}
              >
                <MaterialIcons name="arrow-forward" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.modalDivider} />

          {/* Nearby Ducks — auto-discovered from SEEN / MTALK frames */}
          {nearbyDucks.length > 0 && (
            <>
              <View style={styles.modalSection}>
                <View style={styles.abHeaderRow}>
                  <Text style={styles.modalLabel}>Nearby Ducks</Text>
                  <View style={styles.nearbyPill}>
                    <MaterialIcons name="cell-tower" size={11} color="#22c55e" />
                    <Text style={styles.nearbyPillText}>{nearbyDucks.length} discovered</Text>
                  </View>
                </View>
              </View>
              <ScrollView
                contentContainerStyle={styles.nearbyList}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {nearbyDucks.map((duck) => {
                  const contact = contacts.find((c) => c.duckId === duck.duckId);
                  const label = contact?.name ?? duck.duckId;
                  const alreadyOpen = conversations.some((c) => c.peerId === duck.duckId);
                  return (
                    <Pressable
                      key={duck.duckId}
                      style={({ pressed }) => [
                        styles.nearbyCard,
                        pressed && styles.nearbyCardPressed,
                      ]}
                      onPress={() => openThread(duck.duckId)}
                    >
                      <View style={styles.nearbyAvatar}>
                        <Text style={styles.nearbyAvatarText}>
                          {label.charAt(0).toUpperCase()}
                        </Text>
                        <View style={styles.nearbyDot} />
                      </View>
                      <Text style={styles.nearbyName} numberOfLines={1}>
                        {label}
                      </Text>
                      {contact?.name && (
                        <Text style={styles.nearbyId} numberOfLines={1}>
                          {duck.duckId}
                        </Text>
                      )}
                      {alreadyOpen && (
                        <MaterialIcons name="chat" size={12} color="#f27f0d" />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.modalDivider} />
            </>
          )}

          {/* Address book contacts */}
          <View style={styles.modalSection}>
            <View style={styles.abHeaderRow}>
              <Text style={styles.modalLabel}>Address Book</Text>
              <Pressable
                style={styles.abAddBtn}
                onPress={() => {
                  setAddingContact(true);
                  setContactName("");
                  setContactId(peerDraft.length === 8 ? peerDraft : "");
                }}
              >
                <MaterialIcons name="person-add" size={14} color="#f27f0d" />
                <Text style={styles.abAddBtnText}>Add</Text>
              </Pressable>
            </View>

            {addingContact && (
              <View style={styles.abAddForm}>
                <TextInput
                  autoFocus
                  value={contactName}
                  onChangeText={setContactName}
                  placeholder="Name"
                  placeholderTextColor="#8a7560"
                  style={styles.abInput}
                />
                <TextInput
                  value={contactId}
                  onChangeText={(v) => setContactId(v.toUpperCase())}
                  placeholder="Duck ID (8 chars)"
                  placeholderTextColor="#8a7560"
                  maxLength={8}
                  autoCapitalize="characters"
                  style={[styles.abInput, styles.abInputMono]}
                />
                <View style={styles.abFormActions}>
                  <Pressable
                    style={styles.abCancelBtn}
                    onPress={() => setAddingContact(false)}
                  >
                    <Text style={styles.abCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.abSaveBtn,
                      (contactName.trim().length === 0 ||
                        contactId.length !== 8) && { opacity: 0.4 },
                    ]}
                    disabled={
                      contactName.trim().length === 0 || contactId.length !== 8
                    }
                    onPress={commitAddContact}
                  >
                    <Text style={styles.abSaveText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          <ScrollView
            contentContainerStyle={styles.abList}
            showsVerticalScrollIndicator={false}
          >
            {contacts.length === 0 ? (
              <View style={styles.abEmpty}>
                <MaterialIcons name="contacts" size={36} color="#d1c5b8" />
                <Text style={styles.abEmptyText}>No contacts saved yet</Text>
              </View>
            ) : (
              contacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  style={({ pressed }) => [
                    styles.abRow,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => openThread(contact.duckId)}
                >
                  <View style={styles.abAvatar}>
                    <Text style={styles.abAvatarText}>
                      {contact.name.trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.abInfo}>
                    <Text style={styles.abName}>{contact.name}</Text>
                    <Text style={styles.abId}>{contact.duckId}</Text>
                  </View>
                  <MaterialIcons name="chat" size={20} color="#f27f0d" />
                </Pressable>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700", color: "#181411" },
  newBtn: { padding: 6 },

  // Conversation list
  list: { flexGrow: 1, paddingVertical: 8 },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#b0a090" },
  emptyHint: {
    fontSize: 14,
    color: "#c8bdb0",
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#f27f0d",
  },
  emptyBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },

  // Conversation row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f0ec",
  },
  rowPressed: { backgroundColor: "#fdf9f5" },

  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarContact: { backgroundColor: "#f27f0d" },
  avatarUnknown: { backgroundColor: "#8a7560" },
  avatarText: { fontSize: 19, fontWeight: "700", color: "#fff" },

  rowContent: { flex: 1, gap: 2 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#181411",
  },
  rowTime: { fontSize: 12, color: "#a09080", fontWeight: "500" },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowPreview: { fontSize: 14, color: "#8a7560", flex: 1 },
  idPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "#f0eeec",
    marginTop: 2,
  },
  idPillText: {
    fontSize: 10,
    color: "#8a7560",
    fontWeight: "700",
    letterSpacing: 0.5,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Unread badge
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  // New Conversation Modal
  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f27f0d1f",
  },
  modalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: "#181411",
  },
  modalClose: { padding: 4 },
  modalSection: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  modalLabel: { fontSize: 13, fontWeight: "600", color: "#8a7560" },
  modalDivider: { height: 1, backgroundColor: "#f0eeec" },

  // Duck ID draft row
  draftRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  draftInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#f27f0d",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: "700",
    color: "#181411",
    letterSpacing: 1.5,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  draftCounter: {
    fontSize: 12,
    color: "#b0a090",
    fontWeight: "600",
    minWidth: 24,
  },
  draftCounterOk: { color: "#22c55e" },
  draftBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },

  // Address book section
  abHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  abAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f27f0d33",
    backgroundColor: "#fff5ea",
  },
  abAddBtnText: { fontSize: 12, fontWeight: "700", color: "#f27f0d" },
  abList: { paddingHorizontal: 16, paddingBottom: 20, gap: 8 },
  abEmpty: { alignItems: "center", paddingTop: 24, gap: 8 },
  abEmptyText: { fontSize: 14, color: "#c8bdb0" },
  abAddForm: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#fdf9f5",
    borderWidth: 1,
    borderColor: "#f27f0d33",
    gap: 8,
  },
  abInput: {
    borderWidth: 1,
    borderColor: "#e6e0db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: "#181411",
    backgroundColor: "#fff",
  },
  abInputMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    letterSpacing: 1,
    fontWeight: "700",
  },
  abFormActions: { flexDirection: "row", gap: 8 },
  abCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e6e0db",
    alignItems: "center",
  },
  abCancelText: { fontSize: 14, fontWeight: "600", color: "#8a7560" },
  abSaveBtn: {
    flex: 2,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#f27f0d",
    alignItems: "center",
  },
  abSaveText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  abRow: {
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
  abInfo: { flex: 1, gap: 2 },
  abName: { fontSize: 15, fontWeight: "700", color: "#181411" },
  abId: {
    fontSize: 12,
    color: "#8a7560",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
    letterSpacing: 0.5,
  },

  // Nearby Ducks section
  nearbyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  nearbyPillText: { fontSize: 11, fontWeight: "700", color: "#16a34a" },
  nearbyList: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    flexDirection: "row",
  },
  nearbyCard: {
    alignItems: "center",
    gap: 6,
    width: 72,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: "#fdf9f5",
    borderWidth: 1,
    borderColor: "#f0eeec",
  },
  nearbyCardPressed: { backgroundColor: "#f5f0ea" },
  nearbyAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#22c55e",
    alignItems: "center",
    justifyContent: "center",
  },
  nearbyAvatarText: { fontSize: 19, fontWeight: "700", color: "#fff" },
  nearbyDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#22c55e",
    borderWidth: 2,
    borderColor: "#fff",
  },
  nearbyName: {
    fontSize: 11,
    fontWeight: "700",
    color: "#181411",
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  nearbyId: {
    fontSize: 9,
    color: "#8a7560",
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
