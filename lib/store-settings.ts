import type { Prisma, StoreSettings } from "@prisma/client";
import { db } from "@/lib/db";

type SettingsReader = {
  storeSettings: {
    findFirst(args: { orderBy: Prisma.StoreSettingsOrderByWithRelationInput[] }): Promise<StoreSettings | null>;
  };
};

// Older databases can contain more than one settings row (there is no
// singleton constraint). Always read the oldest row so the storefront,
// checkout, emails and the admin form agree on the same values.
export const STORE_SETTINGS_ORDER: Prisma.StoreSettingsOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

export const DEFAULT_STORE_SETTINGS_ID = "default";

export function getStoreSettings(client: SettingsReader = db): Promise<StoreSettings | null> {
  return client.storeSettings.findFirst({ orderBy: STORE_SETTINGS_ORDER });
}

type NamedSettings = Pick<StoreSettings, "storeName"> | null | undefined;
type EmailSettings = Pick<StoreSettings, "storeEmail"> | null | undefined;

/** Store name configured in the admin settings (CMS). */
export function storeDisplayName(settings: NamedSettings): string {
  return settings?.storeName?.trim() || "Store";
}

/**
 * Customer-facing support address. Only the address configured in the admin
 * settings is shown to customers; ADMIN_EMAIL is an admin identity and is
 * never published.
 */
export function storeSupportEmail(settings: EmailSettings): string | null {
  return settings?.storeEmail?.trim() || null;
}

/** Recipient for operational messages (new orders, alerts, contact form). */
export function adminNotificationEmail(settings: EmailSettings): string | null {
  return settings?.storeEmail?.trim() || process.env.ADMIN_EMAIL?.trim() || null;
}
