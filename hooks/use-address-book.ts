/**
 * useAddressBook — persistent contact list for MTALK duck IDs.
 *
 * Each contact is a { name, duckId } pair stored in AsyncStorage.
 * Contacts are sorted alphabetically by name.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cdk-address-book";

export interface Contact {
  /** Random unique ID — not the duck ID */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Exactly 8-character duck ID (DUCK_NAME), always uppercase */
  duckId: string;
  addedAt: number;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function load(): Promise<Contact[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Contact[];
  } catch {
    return [];
  }
}

async function persist(contacts: Contact[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch {}
}

export function useAddressBook() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    load().then((c) => {
      setContacts(c);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) persist(contacts);
  }, [contacts, loaded]);

  /** Add a new contact. Throws if duckId is not 8 chars or already exists. */
  const addContact = useCallback(
    (name: string, duckId: string): Contact => {
      const trimmedId = duckId.trim().toUpperCase();
      const trimmedName = name.trim();
      if (trimmedName.length === 0) throw new Error("Name is required.");
      if (trimmedId.length !== 8)
        throw new Error("Duck ID must be exactly 8 characters.");
      if (contacts.some((c) => c.duckId === trimmedId))
        throw new Error(`${trimmedId} is already in your address book.`);

      const contact: Contact = {
        id: makeId(),
        name: trimmedName,
        duckId: trimmedId,
        addedAt: Date.now(),
      };
      setContacts((prev) =>
        [...prev, contact].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
      );
      return contact;
    },
    [contacts],
  );

  /** Update an existing contact's name and/or duckId by contact id. */
  const updateContact = useCallback(
    (id: string, patch: Partial<Pick<Contact, "name" | "duckId">>) => {
      setContacts((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== id) return c;
          const name = patch.name !== undefined ? patch.name.trim() : c.name;
          const duckId =
            patch.duckId !== undefined
              ? patch.duckId.trim().toUpperCase()
              : c.duckId;
          return { ...c, name, duckId };
        });
        return updated.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
      });
    },
    [],
  );

  /** Remove a contact by its id. */
  const removeContact = useCallback((id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /** True if a duck ID is already saved. */
  const hasContact = useCallback(
    (duckId: string) =>
      contacts.some((c) => c.duckId === duckId.trim().toUpperCase()),
    [contacts],
  );

  return {
    contacts,
    loaded,
    addContact,
    updateContact,
    removeContact,
    hasContact,
  };
}
