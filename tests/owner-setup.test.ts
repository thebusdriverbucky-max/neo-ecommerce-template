import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { moduleLoader } from './helpers/load-module';

function harness() {
  process.env.ADMIN_EMAIL = 'owner@example.test';
  process.env.NEXTAUTH_URL = 'https://store.example.test';
  process.env.RESEND_API_KEY = 'test-only';
  process.env.EMAIL_FROM = 'store@example.test';
  let setup: any = null;
  let user: any = { id: 'existing-user', email: process.env.ADMIN_EMAIL, role: 'CUSTOMER', sessionVersion: 0, password: 'attacker-password', resetToken: 'attacker-reset' };
  const sent: any[] = [];
  const revoked: string[] = [];
  let delivered = true;
  let transactions = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const tx = {
    $executeRaw: async () => 1,
    ownerSetup: {
      findUnique: async () => setup,
      upsert: async ({ create, update }: any) => { setup = setup ? { ...setup, ...update } : create; return setup; },
      update: async ({ data }: any) => { Object.assign(setup, data); return setup; },
      updateMany: async ({ where, data }: any) => { if (setup?.tokenHash === where.tokenHash) Object.assign(setup, data); return { count: 1 }; },
    },
    user: {
      findFirst: async () => user?.role === 'ADMIN' ? { id: user.id } : null,
      upsert: async ({ update, create }: any) => {
        user = user ? { ...user, ...update, sessionVersion: user.sessionVersion + update.sessionVersion.increment } : { id: 'new-user', ...create };
        return user;
      },
    },
    account: { deleteMany: async () => { revoked.push('accounts'); } },
    session: { deleteMany: async () => { revoked.push('sessions'); } },
  };
  const api = moduleLoader({
    './db': { db: { ...tx, $transaction: (fn: any) => {
      transactions++;
      const result = queue.then(() => fn(tx)); queue = result.catch(() => {}); return result;
    } } },
    './email': { sendEmail: async (payload: any) => { sent.push(payload); return delivered ? { id: 'fake' } : null; } },
    'bcryptjs': { hash: async (password: string) => `hashed:${password}` },
  })('lib/owner-setup.ts');
  return { api, sent, revoked, get user() { return user; }, get setup() { return setup; }, get transactions() { return transactions; },
    failEmail: () => { delivered = false; }, newUser: () => { user = null; },
    token: () => sent.at(-1).html.match(/#token=([a-f0-9]{64})/)[1],
  };
}

test('owner setup sends only to configured address, stores a hash, and throttles repeated requests', async () => {
  const h = harness();
  await h.api.requestOwnerSetup();
  const token = h.token();
  assert.equal(h.sent[0].to, 'owner@example.test');
  assert.match(h.sent[0].html, /https:\/\/store.example.test\/setup#token=/);
  assert.notEqual(h.setup.tokenHash, token);
  assert.equal(h.setup.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.equal(h.user.role, 'CUSTOMER');
  await Promise.all([h.api.requestOwnerSetup(), h.api.requestOwnerSetup()]);
  assert.equal(h.sent.length, 1);
});

test('owner setup requires mail configuration, handles delivery failure and allows retry', async () => {
  const h = harness();
  delete process.env.RESEND_API_KEY;
  await assert.rejects(h.api.requestOwnerSetup, /Connect email/);
  assert.equal(h.transactions, 0);
  process.env.RESEND_API_KEY = 'test-only';
  h.failEmail();
  await assert.rejects(h.api.requestOwnerSetup, /could not be sent/);
  assert.equal(h.setup.tokenHash, null);
  await assert.rejects(h.api.requestOwnerSetup, /could not be sent/);
  assert.equal(h.sent.length, 2);
});

test('owner setup rejects forged/expired links and changed owner address without granting access', async () => {
  const h = harness();
  await h.api.requestOwnerSetup();
  await assert.rejects(() => h.api.completeOwnerSetup('a'.repeat(64), 'safe-password-123', 'Owner'), /invalid/);
  process.env.ADMIN_EMAIL = 'changed@example.test';
  await assert.rejects(() => h.api.completeOwnerSetup(h.token(), 'safe-password-123', 'Owner'), /invalid/);
  process.env.ADMIN_EMAIL = 'owner@example.test';
  h.setup.expiresAt = new Date(0);
  await assert.rejects(() => h.api.completeOwnerSetup(h.token(), 'safe-password-123', 'Owner'), /expired/);
  assert.equal(h.user.role, 'CUSTOMER');
});

test('setup replaces a pre-registered attacker password, clears reset token and revokes old access exactly once', async () => {
  const h = harness();
  await h.api.requestOwnerSetup();
  const results = await Promise.allSettled([1, 2].map(() => h.api.completeOwnerSetup(h.token(), 'safe-password-123', 'Owner')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(h.user.role, 'ADMIN');
  assert.equal(h.user.password, 'hashed:safe-password-123');
  assert.equal(h.user.resetToken, null);
  assert.equal(h.user.sessionVersion, 1);
  assert.ok(h.user.emailVerified);
  assert.deepEqual(h.revoked, ['accounts', 'sessions']);
  assert.equal(h.setup.tokenHash, null);
  assert.ok(h.setup.completedAt);
  await assert.rejects(h.api.requestOwnerSetup, /complete/);
});

test('setup creates an owner without requiring prior customer registration', async () => {
  const h = harness(); h.newUser();
  await h.api.requestOwnerSetup();
  await h.api.completeOwnerSetup(h.token(), 'safe-password-123', 'Owner');
  assert.equal(h.user.role, 'ADMIN');
  assert.equal(h.user.email, 'owner@example.test');
});

test('JWT issued before owner setup cannot inherit administrator access', async () => {
  let config: any;
  moduleLoader({
    'next-auth': (options: any) => { config = options; return {}; },
    'next-auth/providers/google': () => ({}),
    'next-auth/providers/credentials': (options: any) => options,
    '@auth/prisma-adapter': { PrismaAdapter: () => ({}) },
    './db': { db: { user: { findUnique: async () => ({ role: 'ADMIN', sessionVersion: 1 }) } } },
    './rate-limit': { checkRateLimit: async () => ({ success: true }) },
  })('lib/auth.ts');
  assert.equal(await config.callbacks.jwt({ token: { id: 'existing-user', sessionVersion: 0 } }), null);
  assert.equal(await config.callbacks.jwt({ token: { id: 'existing-user' } }), null);
  const fresh = await config.callbacks.jwt({ token: {}, user: { id: 'existing-user', sessionVersion: 1 } });
  assert.equal(fresh.role, 'ADMIN');
  assert.equal(fresh.sessionVersion, 1);
});
