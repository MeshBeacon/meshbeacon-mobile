/**
 * useSettingsStore
 *
 * Persists emergency contacts to AsyncStorage so data survives app restarts.
 * On first launch, an empty list is used instead of hard-coded demo data.
 *
 * Storage key: "cdk-settings"
 *   { contacts: Contact[] }
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cdk-settings";

export type Contact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
};

interface StorageFormat {
  contacts: Contact[];
}

const DEFAULT_CONTACTS: Contact[] = [];

async function loadStorage(): Promise<StorageFormat> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StorageFormat;
  } catch {
    // Fall through to defaults
  }
  return { contacts: DEFAULT_CONTACTS };
}

async function persist(data: StorageFormat): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Non-fatal — in-memory state still works
  }
}

export function useSettingsStore() {
  const [contacts, setContactsState] = useState<Contact[]>(DEFAULT_CONTACTS);
  const [loaded, setLoaded] = useState(false);

  // Hydrate from disk on mount
  useEffect(() => {
    loadStorage().then((data) => {
      setContactsState(data.contacts);
      setLoaded(true);
    });
  }, []);

  // Persist on every change (skip before hydration to avoid overwriting data)
  useEffect(() => {
    if (loaded) persist({ contacts });
  }, [contacts, loaded]);

  const setContacts = useCallback(
    (updater: Contact[] | ((prev: Contact[]) => Contact[])) => {
      setContactsState(updater);
    },
    [],
  );

  return { contacts, setContacts, loaded };
}
