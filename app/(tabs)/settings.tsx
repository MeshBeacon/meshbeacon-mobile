import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
    Image,
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

import { useToast } from "@/contexts/toast-context";
import {
    useSettingsStore,
    type Contact,
    type ProfileInfo,
} from "@/hooks/use-settings-store";

const BLOOD_TYPES = [
  "A Positive",
  "A Negative",
  "B Positive",
  "B Negative",
  "AB Positive",
  "AB Negative",
  "O Positive",
  "O Negative",
];

export default function SettingsScreen() {
  const { showToast, showConfirm } = useToast();
  const { profile, setProfile, contacts, setContacts } = useSettingsStore();
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileInfo>(profile);

  const openEditProfile = () => {
    setProfileDraft(profile);
    setProfileModalVisible(true);
  };

  const saveProfile = () => {
    if (!profileDraft.name.trim()) {
      showToast("Name is required.", "warning");
      return;
    }
    setProfile(profileDraft);
    setProfileModalVisible(false);
  };

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
            <Text style={styles.sectionTitle}>Personal Information</Text>
            <Pressable style={styles.inlineAction} onPress={openEditProfile}>
              <MaterialIcons name="edit" size={16} color="#f27f0d" />
              <Text style={styles.inlineActionText}>Edit</Text>
            </Pressable>
          </View>

          <View style={styles.profileCard}>
            <View style={styles.profileTop}>
              <View style={styles.avatarWrap}>
                <Image
                  source={{
                    uri: "https://lh3.googleusercontent.com/aida-public/AB6AXuDF_J6rd5pZmiLiRwl5HCahyaH-DOcmIWOoNE5Ls_9o8NOUovzVGUVti0ljinn5LxOFrkL4rAQApOKfCx-_cdm8Aq9RU8dFuAxPU2cOcZfASr_NzMakltrOuwIyYV2UIasj6nWOQ9Iqgt7uHUWM-ZM7vxBPtO4lO5zkZPyFiqVEn8tewT8vnc6cg5dVyoIJuqdg845U_3U19uOnILGNTsAMgYaSy-2REa3M1yg6kBHFB6QM2tA3ZDIZ8xnUxYKzchB9xq_T1rOE3Mx5",
                  }}
                  style={styles.avatar}
                />
              </View>
              <View>
                <Text style={styles.medicalLabel}>Medical ID Holder</Text>
                <Text style={styles.profileName}>{profile.name}</Text>
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>BLOOD TYPE</Text>
                <View style={styles.metricValueRow}>
                  <MaterialIcons name="bloodtype" size={18} color="#f27f0d" />
                  <Text style={styles.metricValue}>{profile.bloodType}</Text>
                </View>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>ALLERGIES</Text>
                <View style={styles.metricValueRow}>
                  <MaterialIcons name="warning" size={18} color="#f27f0d" />
                  <Text style={styles.metricValue}>{profile.allergies}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Emergency Contacts</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>
                {contacts.length} Contacts
              </Text>
            </View>
          </View>

          {contacts.map((contact) => (
            <View key={contact.id} style={styles.contactCard}>
              <View
                style={
                  contact.isPrimary
                    ? styles.contactAvatarPrimary
                    : styles.contactAvatarSecondary
                }
              >
                <MaterialIcons
                  name="person"
                  size={22}
                  color={contact.isPrimary ? "#f27f0d" : "#9ca3af"}
                />
              </View>
              <View style={styles.contactInfo}>
                <View style={styles.contactNameRow}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  {contact.isPrimary && (
                    <View style={styles.primaryTag}>
                      <Text style={styles.primaryTagText}>PRIMARY</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.contactMeta}>
                  {contact.relationship} • {contact.phone}
                </Text>
              </View>
              <Pressable
                style={styles.contactAction}
                onPress={() => openEdit(contact)}
              >
                <MaterialIcons name="edit" size={20} color="#a3a3a3" />
              </Pressable>
              <Pressable
                style={styles.contactAction}
                onPress={() => deleteContact(contact.id)}
              >
                <MaterialIcons name="delete" size={20} color="#ef4444" />
              </Pressable>
            </View>
          ))}

          <Pressable style={styles.addContactButton} onPress={openAdd}>
            <MaterialIcons name="add-circle" size={20} color="#6b7280" />
            <Text style={styles.addContactText}>Add Emergency Contact</Text>
          </Pressable>

          <View style={styles.infoBanner}>
            <MaterialIcons name="info" size={20} color="#f27f0d" />
            <Text style={styles.infoText}>
              Emergency contacts can be viewed from your lock screen in case of
              emergency. Make sure their phone numbers are up to date.
            </Text>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.setupButton}>
            <MaterialIcons name="emergency-share" size={20} color="#fff" />
            <Text style={styles.setupText}>Quick Setup Guide</Text>
          </Pressable>
        </View>

        {/* Personal info edit modal */}
        <Modal
          visible={profileModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setProfileModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalContainer}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Personal Information</Text>
              <Pressable onPress={() => setProfileModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#181411" />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.fieldLabel}>Full Name *</Text>
              <TextInput
                style={styles.textInput}
                value={profileDraft.name}
                onChangeText={(v) =>
                  setProfileDraft((d) => ({ ...d, name: v }))
                }
                placeholder="Full name"
                placeholderTextColor="#9ca3af"
              />

              <Text style={styles.fieldLabel}>Blood Type</Text>
              <View style={styles.bloodTypeGrid}>
                {BLOOD_TYPES.map((bt) => {
                  const selected = profileDraft.bloodType === bt;
                  return (
                    <Pressable
                      key={bt}
                      onPress={() =>
                        setProfileDraft((d) => ({ ...d, bloodType: bt }))
                      }
                      style={[
                        styles.bloodTypeChip,
                        selected && styles.bloodTypeChipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.bloodTypeChipText,
                          selected && styles.bloodTypeChipTextSelected,
                        ]}
                      >
                        {bt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Allergies</Text>
              <TextInput
                style={styles.textInput}
                value={profileDraft.allergies}
                onChangeText={(v) =>
                  setProfileDraft((d) => ({ ...d, allergies: v }))
                }
                placeholder="e.g. Penicillin, Nuts"
                placeholderTextColor="#9ca3af"
              />

              <Pressable style={styles.saveButton} onPress={saveProfile}>
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>

              <Pressable
                style={styles.cancelButton}
                onPress={() => setProfileModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

        {/* Contact edit/add modal */}
        <Modal
          visible={modalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalContainer}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingContact ? "Edit Contact" : "Add Contact"}
              </Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#181411" />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput
                style={styles.textInput}
                value={draft.name}
                onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
                placeholder="Full name"
                placeholderTextColor="#9ca3af"
              />

              <Text style={styles.fieldLabel}>Relationship</Text>
              <TextInput
                style={styles.textInput}
                value={draft.relationship}
                onChangeText={(v) =>
                  setDraft((d) => ({ ...d, relationship: v }))
                }
                placeholder="e.g. Wife, Brother"
                placeholderTextColor="#9ca3af"
              />

              <Text style={styles.fieldLabel}>Phone *</Text>
              <TextInput
                style={styles.textInput}
                value={draft.phone}
                onChangeText={(v) => setDraft((d) => ({ ...d, phone: v }))}
                placeholder="(555) 000-0000"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
              />

              <Pressable style={styles.saveButton} onPress={saveContact}>
                <Text style={styles.saveButtonText}>Save Contact</Text>
              </Pressable>

              <Pressable
                style={styles.cancelButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
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
  inlineAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inlineActionText: {
    color: "#f27f0d",
    fontSize: 14,
    fontWeight: "600",
  },
  profileCard: {
    marginTop: 2,
    backgroundColor: "#f8f7f5",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 14,
    gap: 14,
  },
  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "#f27f0d1a",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  medicalLabel: {
    color: "#f27f0d",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  profileName: {
    marginTop: 2,
    color: "#181411",
    fontSize: 28,
    fontWeight: "700",
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#f3f4f6",
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  metricLabel: {
    fontSize: 11,
    color: "#6b7280",
    fontWeight: "600",
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metricValue: {
    color: "#181411",
    fontSize: 18,
    fontWeight: "700",
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
