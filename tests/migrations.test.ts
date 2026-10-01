import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const directory = path.resolve('prisma/migrations');
const migration = '20261001130000_lite_safe_schema_and_bank_transfer';
const sql = (name: string) => readFileSync(path.join(directory, name, 'migration.sql'), 'utf8');
async function legacy(db: PGlite) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isDirectory() && entry.name !== migration) await db.exec(sql(entry.name));
  }
}

test('fresh legacy migration chain plus Lite catch-up creates every modeled column and required unique indexes', async () => {
  const db = new PGlite();
  try {
    await legacy(db);
    await db.exec(sql(migration));
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    for (const model of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
      const columns = await db.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', ['public', model[1]]);
      const names = new Set(columns.rows.map(row => row.column_name));
      for (const field of model[2].matchAll(/^\s+(\w+)\s+(String|Int|Float|Decimal|DateTime|Boolean|Json|UserRole|OrderStatus|DiscountType)(?:\?|\[\])?(?=\s|$)/gm)) {
        assert.ok(names.has(field[1]), `${model[1]}.${field[1]} missing from fresh migration`);
      }
    }
    const indexes = await db.query<{ indexname: string }>('SELECT indexname FROM pg_indexes WHERE schemaname = $1', ['public']);
    for (const name of ['Order_checkoutRequestId_key', 'Review_productId_userId_key', 'Wishlist_userId_productId_key']) {
      assert.ok(indexes.rows.some(row => row.indexname === name), name);
    }
    await db.exec(sql(migration));
  } finally { await db.close(); }
});

test('Lite migration preserves wishlist, existing bank settings, customer text and Full Stripe columns', async () => {
  const db = new PGlite();
  try {
    await legacy(db);
    await db.exec(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('u','owner@example.test',now());
      INSERT INTO "Product" (id,name,slug,description,price,image,category,"updatedAt") VALUES ('p','Product','product','Text',100,'https://example.test/p.png','Books',now());
      INSERT INTO "WishlistItem" (id,"userId","productId") VALUES ('wish','u','p');
      INSERT INTO "ContentPage" (id,slug,title,content,"isVisible","updatedAt") VALUES ('page','about','My title','My content',false,now());
      ALTER TABLE "StoreSettings" ADD COLUMN "paymentIban" TEXT;
      INSERT INTO "StoreSettings" (id,"paymentIban","updatedAt") VALUES ('custom','EXISTING-IBAN',now());
      ALTER TABLE "Order" ADD COLUMN "stripeCheckoutSessionId" TEXT;
      CREATE TABLE "StripeEvent" (id TEXT PRIMARY KEY);
      INSERT INTO "StripeEvent" VALUES ('keep-me');
      INSERT INTO "Order" (id,"userId",subtotal,tax,total,"shippingCost","stripePaymentIntentId","stripeCheckoutSessionId","updatedAt") VALUES ('o','u',100,0,100,0,'pi_keep','cs_keep',now());`);
    await db.exec(sql(migration));
    await db.exec(sql(migration));
    assert.equal((await db.query('SELECT * FROM "Wishlist"')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM "WishlistItem"')).rows.length, 1);
    assert.deepEqual((await db.query('SELECT content,"isVisible" FROM "ContentPage"')).rows, [{ content: 'My content', isVisible: false }]);
    assert.deepEqual((await db.query('SELECT "paymentIban" FROM "StoreSettings"')).rows, [{ paymentIban: 'EXISTING-IBAN' }]);
    assert.deepEqual((await db.query('SELECT "stripePaymentIntentId","stripeCheckoutSessionId","reservationExpiresAt" FROM "Order"')).rows, [{ stripePaymentIntentId: 'pi_keep', stripeCheckoutSessionId: 'cs_keep', reservationExpiresAt: null }]);
    assert.deepEqual((await db.query('SELECT * FROM "StripeEvent"')).rows, [{ id: 'keep-me' }]);
    // Full-style inserts remain possible after Lite adds nullable lifecycle fields.
    await db.exec(`INSERT INTO "Order" (id,subtotal,tax,total,"shippingCost","updatedAt") VALUES ('full-new',100,0,100,0,now());`);
  } finally { await db.close(); }
});

test('ambiguous duplicate legacy reviews stop migration instead of silently discarding customer data', async () => {
  const db = new PGlite();
  try {
    await legacy(db);
    await db.exec(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('u','u@example.test',now());
      INSERT INTO "Product" (id,name,slug,description,price,image,category,"updatedAt") VALUES ('p','P','p','D',1,'url','C',now());
      INSERT INTO "Review" (id,rating,comment,"userId","productId","updatedAt") VALUES ('r1',5,'one','u','p',now()),('r2',4,'two','u','p',now());`);
    await assert.rejects(db.exec(sql(migration)), /Duplicate reviews/);
    assert.equal((await db.query('SELECT * FROM "Review"')).rows.length, 2);
  } finally { await db.close(); }
});

test('Lite additions apply on the actual Full migration history without removing shared objects', async () => {
  const db = new PGlite();
  try {
    // Separate statements/commits matter for PostgreSQL ADD ENUM VALUE.
    const history = readFileSync('tests/fixtures/full-migration-history.sql', 'utf8');
    for (const section of history.split(/\n-- prisma\/migrations\//).slice(1)) {
      await db.exec(section.slice(section.indexOf('\n') + 1));
    }
    const before = await db.query<{ table_name: string; column_name: string }>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name");
    await db.exec(sql(migration));
    const after = await db.query<{ table_name: string; column_name: string }>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
    const names = new Set(after.rows.map(row => `${row.table_name}.${row.column_name}`));
    for (const row of before.rows) assert.ok(names.has(`${row.table_name}.${row.column_name}`));
    assert.ok(names.has('StripeRefund.stripeRefundId'));
    assert.ok(names.has('Order.paymentIban'));
    assert.ok(names.has('User.sessionVersion'));
    await db.exec(sql(migration));
  } finally { await db.close(); }
});
