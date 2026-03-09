"use client";

import React, { createContext, useContext, ReactNode } from "react";
import { StoreSettingsData } from "@/app/actions/settings";

interface SettingsContextType {
  settings: StoreSettingsData | null;
  currency: string;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({
  children,
  initialSettings,
}: {
  children: ReactNode;
  initialSettings: StoreSettingsData | null;
}) {
  const currency = initialSettings?.currency || "USD";

  return (
    <SettingsContext.Provider value={{ settings: initialSettings, currency }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
