// Maintainer/CI integration test. Refuses non-loopback/non-test databases.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { bootstrapStore } from '../lib/bootstrap';
import { createManualOrder, transitionManualOrder } from '../lib/manual-order';
import { moduleLoader } from '../tests/helpers/load-module';

const url = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/lite_(ci|verification)$/.test(url.pathname)) {
  throw new Error('Integration tests require a disposable loopback lite_ci/lite_verification database.');
}
const db = new PrismaClient();
async function main() {
  // Make the disposable verification repeatable without touching non-test rows.
  await db.ownerSetup.deleteMany({ where: { id: 'store-owner' } });
  await db.user.deleteMany({ where: { email: { startsWith: 'owner-', endsWith: '@example.test' } } });
  await bootstrapStore(db);
  const original = await db.contentPage.findUniqueOrThrow({ where: { slug: 'about' } });
  await db.contentPage.update({ where: { id: original.id }, data: { content: 'Integration owner edit', isVisible: false } });
  await bootstrapStore(db); await bootstrapStore(db);
  const preserved = await db.contentPage.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(preserved.content, 'Integration owner edit'); assert.equal(preserved.isVisible, false);
  await db.contentPage.update({ where: { id: original.id }, data: { content: original.content, isVisible: original.isVisible } });

  const settings = await db.storeSettings.findFirstOrThrow();
  await db.storeSettings.update({ where: { id: settings.id }, data: {
    paymentIban: 'TEST-IBAN', paymentBankName: 'Test Bank', paymentAccountName: 'Test Owner', paymentDetails: 'Use order reference', currency: 'USD', taxRate: 0, shippingCost: 0,
  } });
  const suffix = Date.now().toString();
  const product = await db.product.create({ data: { name: 'Integration product', slug: `integration-${suffix}`, description: 'Disposable', price: 100, image: 'https://example.test/image.png', images: [], category: 'Test', stock: 5 } });
  const input = { actor: { userId: null, guestEmail: 'guest@example.test' }, idempotencyKey: `integration-${suffix}`, items: [{ productId: product.id, quantity: 1 }], shippingAddress: {
    firstName: 'Test', lastName: 'Guest', email: 'guest@example.test', phone: '12345678', street: 'Test street', city: 'Test', state: 'Test', postalCode: '12345', country: 'US',
  } };
  const first = await createManualOrder(db, input);
  const replay = await createManualOrder(db, input);
  assert.equal(first.orderId, replay.orderId); assert.equal(first.total, 100);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 4);
  await transitionManualOrder(db, { orderId: first.orderId, nextStatus: 'CANCELLED', adminUserId: 'test-only' });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 5);

  // Execute the actual owner setup module, mocking only the email boundary.
  // This exercises advisory locks, transactions and account/session invalidation.
  process.env.ADMIN_EMAIL = `owner-${suffix}@example.test`;
  process.env.NEXTAUTH_URL = 'https://store.example.test';
  process.env.RESEND_API_KEY = 'fake-not-sent'; process.env.EMAIL_FROM = 'fake@example.test';
  let token = '';
  const owner = moduleLoader({ './db': { db }, './email': { sendEmail: async ({ html }: { html: string }) => {
    token = html.match(/#token=([a-f0-9]{64})/)![1]; return { id: 'mock-delivery' };
  } } })('lib/owner-setup.ts');
  await owner.requestOwnerSetup();
  const results = await Promise.allSettled([1, 2].map(() => owner.completeOwnerSetup(token, 'isolated-test-password-123', 'Test Owner')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL } });
  assert.equal(user.role, 'ADMIN'); assert.equal(user.sessionVersion, 1);
  await assert.rejects(owner.requestOwnerSetup, /complete/);
  console.log('Real disposable PostgreSQL: bootstrap preservation, IBAN checkout/retry/cancel and concurrent owner setup passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
