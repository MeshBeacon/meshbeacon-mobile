import { createContext, useContext, type ReactNode } from "react";

import { useAddressBook, type Contact } from "@/hooks/use-address-book";

interface AddressBookCtx {
  contacts: Contact[];
  loaded: boolean;
  addContact: (name: string, duckId: string) => Contact;
  updateContact: (
    id: string,
    patch: Partial<Pick<Contact, "name" | "duckId">>,
  ) => void;
  removeContact: (id: string) => void;
  hasContact: (duckId: string) => boolean;
}

const Ctx = createContext<AddressBookCtx | null>(null);

export function AddressBookProvider({ children }: { children: ReactNode }) {
  const store = useAddressBook();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useAddressBookCtx(): AddressBookCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useAddressBookCtx must be used inside AddressBookProvider",
    );
  return ctx;
}
