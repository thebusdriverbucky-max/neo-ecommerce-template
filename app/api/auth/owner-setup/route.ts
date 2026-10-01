import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestOwnerSetup, completeOwnerSetup, OwnerSetupError } from '@/lib/owner-setup';
import { checkRateLimit } from '@/lib/rate-limit';
import { getTrustedClientIdentifier } from '@/lib/request-identity';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }).strict(),
  z.object({ action: z.literal('complete'), token: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(2).max(50), password: z.string().min(12).max(72) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const limit = await checkRateLimit(getTrustedClientIdentifier(request), 'forgotPassword');
    if (!limit.success) return NextResponse.json({ message: 'Please wait before trying again.' }, { status: limit.unavailable ? 503 : 429 });
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ message: 'Check your name, link and password (12–72 characters).' }, { status: 400 });
    if (parsed.data.action === 'request') {
      await requestOwnerSetup();
      return NextResponse.json({ message: 'Check the owner email configured for this store, including spam. If you recently requested a link, use that email or wait five minutes before requesting another.' });
    }
    const { token, password, name } = parsed.data;
    return NextResponse.json({ ...await completeOwnerSetup(token, password, name), message: 'Your owner account is ready. Sign in to open your dashboard.' });
  } catch (error) {
    if (error instanceof OwnerSetupError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: 'Setup is temporarily unavailable. Please try again later.' }, { status: 503 });
  }
}
