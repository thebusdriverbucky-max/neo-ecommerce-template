import { PrismaClient } from '@prisma/client';
import { bootstrapStore } from '../lib/bootstrap';

const prisma = new PrismaClient();

async function main() {
  console.log('Bootstrapping required Lite store data...');

  await bootstrapStore(prisma);
  console.log('Required CMS pages are ready. Existing text and visibility were not changed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
