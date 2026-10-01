import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync('template.manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(manifest.template.id, 'neo-ecommerce-lite');
assert.equal(manifest.runtime.node, pkg.engines.node);
assert.equal(manifest.runtime.packageManager, pkg.packageManager);
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
assert.equal(manifest.build.steps.join(' && '), pkg.scripts.build);
assert.equal(manifest.payments.provider, 'bank-transfer');
assert.equal(manifest.build.bootstrap.preservesOwnerData, true);
assert.equal(manifest.build.destructiveReset.guard, 'ALLOW_DEMO_RESET=true');
assert.equal(manifest.template.release.status, 'verified');
assert.equal(manifest.template.release.tag, '');
assert.match(manifest.template.release.commit, /^[a-f0-9]{40}$/);
assert.ok(!pkg.dependencies.stripe);
assert.ok(!Object.keys(lock.packages).some(name => /(?:^|\/)node_modules\/stripe$/.test(name)));

const names = new Set(manifest.environment.map(entry => entry.name));
assert.equal(names.size, manifest.environment.length);
assert.ok(![...names].some(name => name.startsWith('STRIPE_')));
assert.ok(!names.has('DATABASE_URL_UNPOOLED'));
for (const name of ['ADMIN_EMAIL', 'RESEND_API_KEY', 'EMAIL_FROM', 'GUEST_ORDER_TOKEN_SECRET', 'CRON_SECRET']) {
  assert.equal(manifest.environment.find(entry => entry.name === name)?.required, true, name);
}
assert.equal(manifest.environment.find(entry => entry.name === 'LICENSE_PRODUCT').defaultAvailable, false);

function scan(directory) {
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    const name = join(directory, file.name);
    if (file.isDirectory()) scan(name);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) {
      for (const match of readFileSync(name, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        assert.ok(names.has(match[1]) || ['NODE_ENV', 'VERCEL', 'ALLOW_DEMO_RESET'].includes(match[1]), `${name}: undocumented contract variable ${match[1]}`);
      }
    }
  }
}
for (const directory of ['app', 'components', 'lib', 'scripts', 'prisma']) scan(directory);
const schema = readFileSync('prisma/schema.prisma', 'utf8');
for (const match of schema.matchAll(/env\("([A-Z0-9_]+)"\)/g)) assert.ok(names.has(match[1]));
assert.equal(JSON.parse(readFileSync('vercel.json', 'utf8')).crons[0].path, manifest.payments.scheduler.path);
console.log('Lite manifest, lockfile, build, scheduler and source contract are consistent.');
