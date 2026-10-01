import type { PrismaClient } from '@prisma/client';
import { ensureCMSPages } from './cms-defaults';

export async function bootstrapStore(prisma: Pick<PrismaClient, 'storeSettings' | 'contentPage'>) {
  const existing = await prisma.storeSettings.findFirst({ select: { id: true } });
  if (!existing) {
    await prisma.storeSettings.upsert({
      where: { id: 'default' }, update: {},
      create: { id: 'default', currency: 'USD', taxRate: 0, shippingCost: 0,
        freeShippingThreshold: 500, enabledCountries: [], enabledCategories: [] },
    });
  }
  await ensureCMSPages(prisma);
}
