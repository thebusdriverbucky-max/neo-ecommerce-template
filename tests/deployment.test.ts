import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bootstrapStore } from '../lib/bootstrap';
import { CMS_DEFAULT_PAGES } from '../lib/cms-defaults';

test('first bootstrap creates starter CMS; redeploy keeps edits, hidden pages and existing bank settings', async () => {
  let settings: any = null;
  const pages = new Map<string, any>();
  const db: any = {
    storeSettings: { findFirst: async () => settings, upsert: async ({ create, update }: any) => {
      assert.deepEqual(update, {}); settings ??= create;
    } },
    contentPage: { upsert: async ({ where, create, update }: any) => {
      assert.deepEqual(update, {}); if (!pages.has(where.slug)) pages.set(where.slug, { ...create });
    } },
  };
  await bootstrapStore(db);
  assert.equal(pages.size, CMS_DEFAULT_PAGES.length);
  assert.ok(pages.get('about').content);
  settings = { id: 'custom', paymentIban: 'KEEP', currency: 'EUR' };
  pages.set('about', { slug: 'about', title: 'My business', content: 'My edits', isVisible: false });
  await bootstrapStore(db); await bootstrapStore(db);
  assert.deepEqual(settings, { id: 'custom', paymentIban: 'KEEP', currency: 'EUR' });
  assert.deepEqual(pages.get('about'), { slug: 'about', title: 'My business', content: 'My edits', isVisible: false });
});

test('deployment generates client, deploys migrations and bootstraps CMS; seed never resets demo data', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.build, 'prisma generate && prisma migrate deploy && npm run db:bootstrap && next build');
  assert.equal(pkg.scripts['db:seed'], 'npm run db:bootstrap');
  assert.equal(pkg.prisma.seed, 'tsx scripts/db-bootstrap.ts');
  assert.doesNotMatch(pkg.scripts.build, /reset-demo|db push/);
  const reset = readFileSync('prisma/reset-demo.ts', 'utf8');
  assert.ok(reset.indexOf('ALLOW_DEMO_RESET') < reset.indexOf('deleteMany'));
  assert.match(reset, /NODE_ENV === "production"/);
});
