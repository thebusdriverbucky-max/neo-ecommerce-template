import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { sendEmail } from './email';

const ID = 'store-owner';
const TTL = 30 * 60 * 1000;
const COOLDOWN = 5 * 60 * 1000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class OwnerSetupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function configuration() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const origin = process.env.NEXTAUTH_URL?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OwnerSetupError('Add your owner email in the hosting dashboard (ADMIN_EMAIL), then redeploy.', 503);
  }
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_FROM?.trim()) {
    throw new OwnerSetupError('Connect email delivery in the hosting dashboard: add RESEND_API_KEY and a verified EMAIL_FROM sender, then redeploy.', 503);
  }
  let url: URL;
  try { url = new URL(origin || ''); } catch {
    throw new OwnerSetupError('Set NEXTAUTH_URL to your store address in the hosting dashboard, then redeploy.', 503);
  }
  if (url.username || url.password || !['https:', 'http:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new OwnerSetupError('Use your secure store address (https) for NEXTAUTH_URL.', 503);
  }
  return { email, origin: url.origin };
}

// Database advisory lock serializes setup requests/completions across all instances.
// Never use the customer account or ADMIN_EMAIL alone as proof of ownership.
export async function requestOwnerSetup() {
  const { email, origin } = configuration();
  const token = randomBytes(32).toString('hex');
  const tokenHash = hash(token);
  const issued = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(74011301)`;
    const previous = await tx.ownerSetup.findUnique({ where: { id: ID } });
    if (previous?.completedAt || await tx.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } })) {
      throw new OwnerSetupError('Owner setup is complete. Sign in, or use Forgot password.', 409);
    }
    if (previous?.tokenHash && previous.requestedAt.getTime() > Date.now() - COOLDOWN) return false;
    const data = { email, tokenHash, requestedAt: new Date(), expiresAt: new Date(Date.now() + TTL) };
    await tx.ownerSetup.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
    return true;
  });
  if (!issued) return;
  // Fragment keeps the secret out of HTTP request URLs, access logs and referrers.
  const link = `${origin}/setup#token=${token}`;
  const sent = await sendEmail({
    to: email,
    subject: 'Set up your store owner account',
    html: `<p>You requested initial store owner setup.</p><p><a href="${link}">Set your password and open your store dashboard</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, ignore this email.</p>`,
  });
  if (!sent) {
    await db.ownerSetup.updateMany({ where: { id: ID, tokenHash, completedAt: null }, data: { tokenHash: null, expiresAt: null } });
    throw new OwnerSetupError('The setup email could not be sent. Check the verified sender and email delivery settings in your hosting dashboard, then try again.', 503);
  }
}

export async function completeOwnerSetup(token: string, password: string, name: string) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new OwnerSetupError('Owner email is not configured.', 503);
  const passwordHash = await bcrypt.hash(password, 12);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(74011301)`;
    const setup = await tx.ownerSetup.findUnique({ where: { id: ID } });
    if (!setup || setup.completedAt || setup.email !== email || setup.tokenHash !== hash(token) ||
        !setup.expiresAt || setup.expiresAt.getTime() <= Date.now()) {
      throw new OwnerSetupError('This setup link is invalid, expired or already used. Request a new link.');
    }
    if (await tx.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } })) {
      throw new OwnerSetupError('Owner setup is complete. Sign in, or use Forgot password.', 409);
    }
    const user = await tx.user.upsert({
      where: { email },
      create: { email, name, password: passwordHash, role: 'ADMIN', emailVerified: new Date(), sessionVersion: 1 },
      update: { name, password: passwordHash, role: 'ADMIN', emailVerified: new Date(), sessionVersion: { increment: 1 }, resetToken: null, resetTokenExpiry: null },
    });
    // A previously registered address must not retain passwords, reset tokens,
    // provider accounts or sessions belonging to the pre-registration attacker.
    await tx.account.deleteMany({ where: { userId: user.id } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.ownerSetup.update({ where: { id: ID }, data: { completedAt: new Date(), tokenHash: null, expiresAt: null } });
    return { email };
  });
}
