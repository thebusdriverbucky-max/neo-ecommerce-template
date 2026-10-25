'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { DEFAULT_PAYMENT_FALLBACK_MESSAGE } from '@/lib/payment-instructions';
import { DEFAULT_STORE_SETTINGS_ID, getStoreSettings } from '@/lib/store-settings';
import { DEFAULT_FREE_SHIPPING_THRESHOLD } from '@/lib/shipping';
import { settingsFieldErrors, settingsSchemaFor } from '@/lib/settings-validation';
import { logger } from '@/lib/logger';

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
  paymentIban?: string | null;
  paymentBankName?: string | null;
  paymentAccountName?: string | null;
  paymentDetails?: string | null;
}

export async function getSettings() {
  try {
    const settings = await getStoreSettings(prisma) || {
      id: null,
      currency: 'USD',
      taxRate: 0,
      shippingCost: 0,
      freeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD,
      enabledCountries: [],
      enabledCategories: [],
      paymentIban: null,
      paymentBankName: null,
      paymentAccountName: null,
      paymentDetails: null,
    };
    return {
      success: true,
      data: {
        ...settings,
        paymentDetails: settings.paymentDetails?.trim() || DEFAULT_PAYMENT_FALLBACK_MESSAGE,
      },
    };
  } catch (error) {
    logger.error('Failed to fetch settings');
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
    if (session?.user?.role !== 'ADMIN') {
      return { success: false, error: 'Unauthorized' };
    }

    const settings = await getStoreSettings(prisma);
    const storedCurrency = settings?.currency ?? 'USD';

    const parsed = settingsSchemaFor(storedCurrency).safeParse(data);
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
      paymentIban: values.paymentIban,
      paymentBankName: values.paymentBankName,
      paymentAccountName: values.paymentAccountName,
      paymentDetails: values.paymentDetails,
    };

    const currencyChanged = storedCurrency !== values.currency;

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

      // Checkout rejects orders when a product currency differs from the
      // store currency. Prices are NOT converted, only relabelled.
      if (currencyChanged) {
        await tx.product.updateMany({ data: { currency: values.currency } });
      }
    });

    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    logger.error('Failed to update settings');
    return { success: false, error: 'Failed to update settings' };
  }
}
