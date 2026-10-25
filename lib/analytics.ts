// lib/analytics.ts - Analytics wrapper (ready for future integration)

export const analytics = {
  // Will be configured when client provides GA4 tracking ID
  pageview: (url: string) => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('config', process.env.NEXT_PUBLIC_GA_ID || '', {
        page_path: url,
      });
    }
  },

  event: (action: string, params?: Record<string, any>) => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', action, params);
    }
  },

  // Track purchases; pass the store currency from the admin settings.
  purchase: (orderId: string, value: number, items: any[], currency = 'USD') => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'purchase', {
        transaction_id: orderId,
        value,
        currency,
        items,
      });
    }
  },
};

// TypeScript types for gtag
declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}
