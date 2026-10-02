'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { DEFAULT_PAYMENT_FALLBACK_MESSAGE } from '@/lib/payment-instructions';

export interface StoreSettingsData {
  storeName?: string;
  storeEmail?: string;
  currency: string;
  taxRate: number;
  shippingCost: number;
  freeShippingThreshold: number;
  enabledCountries: string[];
  enabledCategories: string[];
  tiktokUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroButtonText?: string;
  ctaTitle?: string;
  ctaSubtitle?: string;
  ctaButtonText?: string;
  footerCopyright?: string;
  faviconUrl?: string;
  ogImageUrl?: string;
  siteLang?: string;
  paymentIban?: string;
  paymentBankName?: string;
  paymentAccountName?: string;
  paymentDetails?: string;
}

export async function getSettings() {
  try {
    const settings = await prisma.storeSettings.findFirst() || {
      id: null,
      currency: 'USD',
      taxRate: 0,
      shippingCost: 0,
      freeShippingThreshold: 500,
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
    console.error('Error fetching settings:', error);
    return { success: false, error: 'Failed to fetch settings' };
  }
}

export async function updateSettings(data: StoreSettingsData) {
  try {
    const session = await auth();
    if (session?.user?.role !== 'ADMIN') {
      return { success: false, error: 'Unauthorized' };
    }

    const currency = data.currency?.trim().toUpperCase();
    const taxRate = Number(data.taxRate);
    const shippingCost = Number(data.shippingCost);
    const freeShippingThreshold = Number(data.freeShippingThreshold);

    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return { success: false, error: 'Invalid currency or tax rate' };
    }
    if (!Number.isFinite(shippingCost) || shippingCost < 0) {
      return { success: false, error: 'Shipping cost must be zero or greater' };
    }
    if (!Number.isFinite(freeShippingThreshold) || freeShippingThreshold < 0) {
      return { success: false, error: 'Free shipping threshold must be zero or greater' };
    }

    const settings = await prisma.storeSettings.findFirst();

    await prisma.$transaction(async (tx) => {
      if (settings) {
        await tx.storeSettings.update({
          where: { id: settings.id },
          data: {
            storeName: data.storeName,
            storeEmail: data.storeEmail,
            currency,
            taxRate,
            shippingCost,
            freeShippingThreshold,
            enabledCountries: data.enabledCountries,
            enabledCategories: data.enabledCategories,
            tiktokUrl: data.tiktokUrl,
            facebookUrl: data.facebookUrl,
            instagramUrl: data.instagramUrl,
            heroTitle: data.heroTitle,
            heroSubtitle: data.heroSubtitle,
            heroButtonText: data.heroButtonText,
            ctaTitle: data.ctaTitle,
            ctaSubtitle: data.ctaSubtitle,
            ctaButtonText: data.ctaButtonText,
            footerCopyright: data.footerCopyright,
            faviconUrl: data.faviconUrl,
            ogImageUrl: data.ogImageUrl,
            siteLang: data.siteLang,
            paymentIban: data.paymentIban,
            paymentBankName: data.paymentBankName,
            paymentAccountName: data.paymentAccountName,
            paymentDetails: data.paymentDetails,
          } as any,
        });
      } else {
        await tx.storeSettings.create({
          data: {
            storeName: data.storeName,
            storeEmail: data.storeEmail,
            currency,
            taxRate,
            shippingCost,
            freeShippingThreshold,
            enabledCountries: data.enabledCountries,
            enabledCategories: data.enabledCategories,
            tiktokUrl: data.tiktokUrl,
            facebookUrl: data.facebookUrl,
            instagramUrl: data.instagramUrl,
            heroTitle: data.heroTitle,
            heroSubtitle: data.heroSubtitle,
            heroButtonText: data.heroButtonText,
            ctaTitle: data.ctaTitle,
            ctaSubtitle: data.ctaSubtitle,
            ctaButtonText: data.ctaButtonText,
            footerCopyright: data.footerCopyright,
            faviconUrl: data.faviconUrl,
            ogImageUrl: data.ogImageUrl,
            siteLang: data.siteLang,
            paymentIban: data.paymentIban,
            paymentBankName: data.paymentBankName,
            paymentAccountName: data.paymentAccountName,
            paymentDetails: data.paymentDetails,
          } as any,
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
