'use server';

console.log('DEBUG: settings.ts loaded');

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';

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
    let settings = await prisma.storeSettings.findFirst();

    if (!settings) {
      settings = await prisma.storeSettings.create({
        data: {
          currency: 'USD',
          taxRate: 0,
          shippingCost: 0,
          freeShippingThreshold: 500,
          enabledCountries: [],
          enabledCategories: [],
        },
      });
    }
    return { success: true, data: settings };
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

    const settings = await prisma.storeSettings.findFirst();
    const currencyChanged = settings?.currency !== data.currency;

    await prisma.$transaction(async (tx) => {
      if (settings) {
        await tx.storeSettings.update({
          where: { id: settings.id },
          data: {
            storeName: data.storeName,
            storeEmail: data.storeEmail,
            currency: data.currency,
            taxRate: data.taxRate,
            shippingCost: data.shippingCost,
            freeShippingThreshold: data.freeShippingThreshold,
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
          },
        });
      } else {
        await tx.storeSettings.create({
          data: {
            storeName: data.storeName,
            storeEmail: data.storeEmail,
            currency: data.currency,
            taxRate: data.taxRate,
            shippingCost: data.shippingCost,
            freeShippingThreshold: data.freeShippingThreshold,
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
          },
        });
      }

      // Если валюта изменилась, обновляем её у всех товаров
      if (currencyChanged) {
        await tx.product.updateMany({
          data: {
            currency: data.currency,
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
