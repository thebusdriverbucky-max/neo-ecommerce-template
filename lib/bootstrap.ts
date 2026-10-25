import type { PrismaClient } from '@prisma/client';
import { ensureCMSPages } from './cms-defaults';
import { DEFAULT_FREE_SHIPPING_THRESHOLD } from './shipping';

// Same id as DEFAULT_STORE_SETTINGS_ID in lib/store-settings.ts. Not imported
// from there because that module opens the app's database connection.
const DEFAULT_SETTINGS_ID = 'default';

export async function bootstrapStore(prisma: Pick<PrismaClient, 'storeSettings' | 'contentPage'>) {
  // Only existence matters here, so row order is irrelevant: any existing row
  // means the store is configured and no second row must be created.
  const existing = await prisma.storeSettings.findFirst({ select: { id: true } });
  if (!existing) {
    await prisma.storeSettings.upsert({
      where: { id: DEFAULT_SETTINGS_ID }, update: {},
      create: { id: DEFAULT_SETTINGS_ID, currency: 'USD', taxRate: 0, shippingCost: 0,
        freeShippingThreshold: DEFAULT_FREE_SHIPPING_THRESHOLD, enabledCountries: [], enabledCategories: [] },
    });
  }
  await ensureCMSPages(prisma);
}
