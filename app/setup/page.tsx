'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function OwnerSetupPage() {
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
    // Remove secret from browser history before the owner interacts with the page.
    window.history.replaceState(null, '', '/setup');
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (token && data.get('password') !== data.get('confirmation')) {
      setMessage('Passwords do not match.'); return;
    }
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/owner-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { action: 'complete', token, name: data.get('name'), password: data.get('password') } : { action: 'request' }),
      });
      const result = await response.json();
      setMessage(result.message);
      if (response.ok && token) { setDone(true); setToken(''); }
    } catch { setMessage('Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-lg px-4 py-16">
    <h1 className="text-3xl font-bold mb-4">Set up your store</h1>
    <p className="mb-6">No terminal needed. Confirm the owner email, choose a password, and manage your store from the dashboard.</p>
    {message && <p role="status" className="mb-6 rounded border p-4">{message}</p>}
    {!done && <form onSubmit={submit} className="space-y-4">
      {token ? <>
        <label className="block">Your name<input name="name" autoComplete="name" required minLength={2} maxLength={50} className="block w-full rounded border bg-transparent p-3" /></label>
        <label className="block">New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} className="block w-full rounded border bg-transparent p-3" /></label>
        <label className="block">Confirm password<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={72} className="block w-full rounded border bg-transparent p-3" /></label>
        <p className="text-sm">This replaces any previous password for the owner address and signs out previous sessions.</p>
      </> : <p>We will send a one-time setup link to the owner email specified in your hosting settings. The link expires after 30 minutes.</p>}
      <button disabled={!ready || busy} className="rounded bg-blue-600 px-5 py-3 text-white disabled:opacity-50">{busy ? 'Please wait…' : token ? 'Create owner access' : 'Email me a setup link'}</button>
    </form>}
    <p className="mt-6"><Link href="/login?callbackUrl=/admin" className="text-blue-600 underline">Sign in to your dashboard</Link></p>
    {!done && <p className="mt-4 text-sm">Email not arriving? Check spam and your verified sender in the email provider dashboard. Your hosting settings must include your owner email, store address and email delivery credentials. Redeploy after changing those settings. Once an administrator exists, initial setup is closed; use Forgot password instead.</p>}
  </main>;
}
