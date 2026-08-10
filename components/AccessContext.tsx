"use client";

import { createContext, useContext } from "react";

export type AppRole = "admin" | "user";
export type AppSection = "REL" | "GP" | "FA" | "CAL";

export type AppAccess = {
  role: AppRole;
  section: AppSection | null;
};

const AccessContext = createContext<AppAccess | null>(null);

export function AccessProvider({
  access,
  children,
}: {
  access: AppAccess;
  children: React.ReactNode;
}) {
  return (
    <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
  );
}

export function useAccess(): AppAccess {
  const access = useContext(AccessContext);
  if (!access) {
    throw new Error("useAccess must be used inside AccessProvider");
  }
  return access;
}

export function canWorkOnLocation(
  access: AppAccess,
  location: string | null
): boolean {
  return access.role === "admin" || location === access.section;
}
