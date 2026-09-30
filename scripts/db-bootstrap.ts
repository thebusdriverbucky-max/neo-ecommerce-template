import { PrismaClient } from '@prisma/client';
import { ensureCMSPages } from '../lib/cms-defaults';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS_ID = 'default';

async function main() {
  console.log('Bootstrapping required store data...');

  const existingSettings = await prisma.storeSettings.findFirst({
    select: { id: true },
  });

  if (!existingSettings) {
    await prisma.storeSettings.upsert({
      where: { id: DEFAULT_SETTINGS_ID },
      update: {},
      create: {
        id: DEFAULT_SETTINGS_ID,
        currency: 'USD',
        taxRate: 0,
        shippingCost: 0,
        freeShippingThreshold: 500,
        enabledCountries: [],
        enabledCategories: [],
      },
    });
    console.log('Created default store settings.');
  } else {
    console.log('Store settings already exist; leaving them unchanged.');
  }

  await ensureCMSPages(prisma);
  console.log('Required store data is ready. Existing content was not changed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
