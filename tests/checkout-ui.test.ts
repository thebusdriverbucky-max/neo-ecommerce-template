import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { moduleLoader } from './helpers/load-module';

test('checkout survives disabled session storage, prevents double submission and displays authoritative total', async () => {
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://store.example.test/checkout' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) install(name, value);
  install('sessionStorage', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } });
  let submissions = 0;
  let release: (response: Response) => void = () => {};
  const reconciled: unknown[] = [];
  install('fetch', async () => { submissions++; return new Promise<Response>(resolve => { release = resolve; }); });
  const load = moduleLoader({
    'next-auth/react': { useSession: () => ({ data: null }) },
    'next/navigation': { useRouter: () => ({ push() {} }), redirect() { throw Error('unexpected redirect'); } },
    '@/lib/cart-store': { useCart: () => ({ items: [{ productId: 'p', quantity: 1 }], discount: { code: 'TEN' }, reconcilePurchase: (items: unknown) => reconciled.push(items) }) },
    '@/components/shop/checkout-form': { CheckoutForm: ({ onSubmit }: any) => React.createElement('button', { onClick: () => onSubmit({ shippingAddress: { email: 'guest@example.test' } }) }, 'Submit') },
    '@/components/shop/order-summary': { OrderSummary: () => null },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(React.createElement(load('app/(shop)/checkout/page.tsx').default)));
    const button = dom.window.document.querySelector('button')!;
    await act(async () => { Simulate.click(button); Simulate.click(button); });
    assert.equal(submissions, 1);
    await act(async () => release(Response.json({ orderId: 'order12345', orderNumber: 'BANK-1', total: 90, currency: 'USD', paymentIban: 'TEST-IBAN', paymentBankName: 'Bank', paymentAccountName: 'Owner', paymentDetails: 'Use reference', orderUrl: '/orders/order12345?token=private', purchasedItems: [{ productId: 'p', quantity: 1 }] })));
    assert.match(dom.window.document.body.textContent!, /90/);
    assert.match(dom.window.document.body.textContent!, /TEST-IBAN/);
    assert.equal(reconciled.length, 1);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
