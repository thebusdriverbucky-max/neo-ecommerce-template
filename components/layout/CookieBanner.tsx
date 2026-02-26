// components/layout/CookieBanner.tsx (ИСПРАВЛЕННАЯ ВЕРСИЯ)

'use client';

import { useState, useEffect } from 'react';

export function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const cookieConsent = localStorage.getItem('cookie-consent');
    if (!cookieConsent) {
      setShowBanner(true);
    }
  }, []);

  const handleAcceptAll = () => {
    localStorage.setItem('cookie-consent', 'all');
    // Здесь можно инициализировать Google Analytics, если подключен
    setShowBanner(false);
  };

  const handleEssentialOnly = () => {
    localStorage.setItem('cookie-consent', 'essential');
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-4 z-50 border-t border-gray-800">
      <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm mb-2 font-semibold">🍪 This site uses cookies</p>
          <p className="text-xs text-gray-300">
            We use <strong>essential cookies</strong> for authentication and cart functionality (required for the site to work).
            Optional cookies help us analyze site usage. Read our{" "}
            <a href="/privacy" className="text-blue-400 hover:underline">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/cookies" className="text-blue-400 hover:underline">
              Cookie Policy
            </a>.
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={handleEssentialOnly}
            className="px-4 py-2 text-sm border border-gray-600 rounded hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            Essential Only
          </button>
          <button
            onClick={handleAcceptAll}
            className="px-4 py-2 text-sm bg-blue-600 rounded hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}
