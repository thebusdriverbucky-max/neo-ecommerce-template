'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { DEFAULT_STORE_SETTINGS_ID, getStoreSettings } from '@/lib/store-settings';
import { DEFAULT_FREE_SHIPPING_THRESHOLD } from '@/lib/shipping';
import { settingsFieldErrors, settingsSchema } from '@/lib/settings-validation';

export interface StoreSettingsData {
  storeName?: string | null;
  storeEmail?: string | null;
  currency: string;
  taxRate: number;
  shippingCost: number;
  // null disables free shipping; 0 makes every order ship free.
  freeShippingThreshold: number | null;
  enabledCountries: string[];
  enabledCategories: string[];
  tiktokUrl?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  heroButtonText?: string | null;
  ctaTitle?: string | null;
  ctaSubtitle?: string | null;
  ctaButtonText?: string | null;
  footerCopyright?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  siteLang?: string | null;
}

// Shown by the admin form before the first save. Never written to the
// database: this action is public, so reading must not create rows.
const DEFAULT_SETTINGS: StoreSettingsData = {
  storeName: null,
  storeEmail: null,
  currency: 'USD',
  taxRate: 0,
  shippingCost: 0,
  freeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
  enabledCountries: [],
  enabledCategories: [],
  tiktokUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  heroTitle: null,
  heroSubtitle: null,
  heroButtonText: null,
  ctaTitle: null,
  ctaSubtitle: null,
  ctaButtonText: null,
  footerCopyright: null,
  faviconUrl: null,
  ogImageUrl: null,
  siteLang: 'en',
};

export async function getSettings() {
  try {
    const settings = await getStoreSettings(prisma);
    return { success: true, data: settings ?? { ...DEFAULT_SETTINGS } };
  } catch (error) {
    console.error('Error fetching settings:', error);
    return { success: false, error: 'Failed to fetch settings' };
  }
}

export interface UpdateSettingsResult {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function updateSettings(data: StoreSettingsData): Promise<UpdateSettingsResult> {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") {
      return { success: false, error: 'Unauthorized' };
    }

    const parsed = settingsSchema.safeParse(data);
    if (!parsed.success) {
      return {
        success: false,
        error: 'Please correct the highlighted fields.',
        fieldErrors: settingsFieldErrors(parsed.error.issues),
      };
    }
    const values = parsed.data;

    // Omitted keys stay unchanged (Prisma ignores undefined); null/"" clears.
    const fields = {
      storeName: values.storeName,
      storeEmail: values.storeEmail,
      currency: values.currency,
      taxRate: values.taxRate,
      shippingCost: values.shippingCost,
      freeShippingThreshold: values.freeShippingThreshold,
      enabledCountries: values.enabledCountries,
      enabledCategories: values.enabledCategories,
      tiktokUrl: values.tiktokUrl,
      facebookUrl: values.facebookUrl,
      instagramUrl: values.instagramUrl,
      heroTitle: values.heroTitle,
      heroSubtitle: values.heroSubtitle,
      heroButtonText: values.heroButtonText,
      ctaTitle: values.ctaTitle,
      ctaSubtitle: values.ctaSubtitle,
      ctaButtonText: values.ctaButtonText,
      footerCopyright: values.footerCopyright,
      faviconUrl: values.faviconUrl,
      ogImageUrl: values.ogImageUrl,
      siteLang: values.siteLang,
    };

    const settings = await getStoreSettings(prisma);
    const currencyChanged = (settings?.currency ?? 'USD') !== values.currency;

    await prisma.$transaction(async (tx) => {
      if (settings) {
        await tx.storeSettings.update({ where: { id: settings.id }, data: fields });
      } else {
        await tx.storeSettings.upsert({
          where: { id: DEFAULT_STORE_SETTINGS_ID },
          create: { id: DEFAULT_STORE_SETTINGS_ID, ...fields },
          update: fields,
        });
      }

      // Products carry their own currency; prices are NOT converted.
      if (currencyChanged) {
        await tx.product.updateMany({
          data: {
            currency: values.currency,
          },
        });
      }
    });

    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    console.error('Error updating settings:', error);
    return { success: false, error: 'Failed to update settings' };
  }
}
