import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
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
import { useSerial } from "@/contexts/serial-context";
import { useToast } from "@/contexts/toast-context";
import { useSettingsStore, type Contact } from "@/hooks/use-settings-store";
import { RADIO_REGIONS } from "@/services/transport";

export default function SettingsScreen() {
  const { showToast, showConfirm } = useToast();
  const { contacts, setContacts } = useSettingsStore();

  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [draft, setDraft] = useState<Omit<Contact, "id" | "isPrimary">>({
    name: "",
    relationship: "",
    phone: "",
  });

  const openEdit = (contact: Contact) => {
    setEditingContact(contact);
    setDraft({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
    });
    setModalVisible(true);
  };

  const openAdd = () => {
    setEditingContact(null);
    setDraft({ name: "", relationship: "", phone: "" });
    setModalVisible(true);
  };

  const saveContact = () => {
    if (!draft.name.trim() || !draft.phone.trim()) {
      showToast("Name and phone number are required.", "warning");
      return;
    }
    if (editingContact) {
      setContacts((prev) =>
        prev.map((c) => (c.id === editingContact.id ? { ...c, ...draft } : c)),
      );
    } else {
      setContacts((prev) => [
        ...prev,
        { id: Date.now().toString(), isPrimary: false, ...draft },
      ]);
    }
    setModalVisible(false);
  };

  const deleteContact = (id: string) => {
    showConfirm({
      title: "Remove Contact",
      message: "Remove this emergency contact?",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => setContacts((prev) => prev.filter((c) => c.id !== id)),
    });
  };

  // ── Device / LoRa region ──────────────────────────────────────────────────
  const { status, sendRadioRegion, radioRegion } = useSerial();
  const [applyingRegion, setApplyingRegion] = useState(false);
  const queriedRegionRef = useRef(false);

  useEffect(() => {
    if (status === "connected") {
      if (!queriedRegionRef.current) {
        queriedRegionRef.current = true;
        sendRadioRegion().catch(() => {});
      }
    } else {
      queriedRegionRef.current = false;
    }
  }, [status, sendRadioRegion]);

  useEffect(() => {
    if (applyingRegion && radioRegion) setApplyingRegion(false);
  }, [radioRegion, applyingRegion]);

  const confirmApplyRegion = (code: string, label: string) => {
    if (code === radioRegion?.value || applyingRegion) return;
    showConfirm({
      title: "Change LoRa Region",
      message: `Set the device's LoRa region to ${label}? The device must be rebooted afterwards for the change to take effect.`,
      confirmText: "Change",
      onConfirm: async () => {
        setApplyingRegion(true);
        try {
          await sendRadioRegion(code);
        } catch {
          setApplyingRegion(false);
          showToast(
            "Failed to send region change. Check the connection.",
            "error",
          );
        }
      },
    });
  };
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Emergency Settings</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Device</Text>
          </View>

          <SerialStatusBanner />

          <View style={styles.deviceCard}>
            <Text style={styles.fieldLabel}>LoRa Region</Text>
            <Text style={styles.deviceHint}>
              Select the frequency preset that matches where this device will
              operate. Connect via USB or Bluetooth to view or change it.
            </Text>

            <View style={styles.bloodTypeGrid}>
              {RADIO_REGIONS.map(({ code, label }) => {
                const selected = radioRegion?.value === code;
                const disabled = status !== "connected" || applyingRegion;
                return (
                  <Pressable
                    key={code}
                    disabled={disabled}
                    onPress={() => confirmApplyRegion(code, label)}
                    style={[
                      styles.bloodTypeChip,
                      selected && styles.bloodTypeChipSelected,
                      disabled && styles.chipDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bloodTypeChipText,
                        selected && styles.bloodTypeChipTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {applyingRegion && (
              <Text style={styles.deviceHint}>Sending…</Text>
            )}

            {radioRegion?.error && (
              <Text style={styles.deviceError}>
                {radioRegion.error === "unknown_region"
                  ? "Unrecognised region code."
                  : "Device could not save the new region."}
              </Text>
            )}
          </View>

          {radioRegion?.rebootRequired && (
            <View style={styles.infoBanner}>
              <MaterialIcons name="restart-alt" size={20} color="#f27f0d" />
              <Text style={styles.infoText}>
                Region updated to {radioRegion.value}. Reboot the device
                (power cycle) for the new region to take effect.
              </Text>
            </View>
          )}
        </ScrollView>
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
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#181411",
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  sectionHeader: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#181411",
  },
  countBadge: {
    backgroundColor: "#f27f0d",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  deviceCard: {
    marginTop: 2,
    backgroundColor: "#f8f7f5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 14,
    gap: 6,
  },
  deviceHint: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 18,
  },
  deviceError: {
    color: "#b91c1c",
    fontSize: 13,
    marginTop: 4,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
  },
  contactAvatarPrimary: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "#f27f0d1a",
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarSecondary: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  contactInfo: {
    flex: 1,
    gap: 2,
  },
  contactNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contactName: {
    color: "#181411",
    fontSize: 16,
    fontWeight: "700",
  },
  contactMeta: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "500",
  },
  primaryTag: {
    backgroundColor: "#f27f0d33",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  primaryTagText: {
    color: "#f27f0d",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  contactAction: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  addContactButton: {
    marginTop: 2,
    borderWidth: 2,
    borderColor: "#d1d5db",
    borderStyle: "dashed",
    borderRadius: 12,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addContactText: {
    color: "#6b7280",
    fontSize: 16,
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#181411",
  },
  modalContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 6,
  },
  bloodTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  bloodTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  bloodTypeChipSelected: {
    borderColor: "#f27f0d",
    backgroundColor: "#f27f0d",
  },
  bloodTypeChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  bloodTypeChipTextSelected: {
    color: "#fff",
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#181411",
    marginTop: 12,
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#181411",
  },
  saveButton: {
    marginTop: 28,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#f27f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cancelButton: {
    marginTop: 12,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    color: "#6b7280",
    fontSize: 17,
    fontWeight: "600",
  },
  infoBanner: {
    marginTop: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ffedd5",
    backgroundColor: "#fff7ed",
    flexDirection: "row",
    gap: 10,
  },
  infoText: {
    flex: 1,
    color: "#9a3412",
    fontSize: 13,
    lineHeight: 18,
  },
  bottomSpacer: {
    height: 72,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#fff",
  },
  setupButton: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: "#f27f0d",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  setupText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
});
