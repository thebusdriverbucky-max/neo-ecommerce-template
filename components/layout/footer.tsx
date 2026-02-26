// File: components/layout/footer.tsx

"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { getSettings, StoreSettingsData } from "@/app/actions/settings";

export function Footer() {
  const [settings, setSettings] = useState<StoreSettingsData | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      const result = await getSettings();
      if (result.success && result.data) {
        setSettings(result.data as unknown as StoreSettingsData);
      }
    };
    fetchSettings();
  }, []);

  const year = new Date().getFullYear();
  const storeName = settings?.storeName || 'E-Commerce Store';
  const copyright = settings?.footerCopyright || `© ${year} ${storeName}. All rights reserved.`;

  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-white font-bold mb-4">About</h3>
            <ul className="space-y-2">
              <li><Link href="/about" className="hover:text-white">About Us</Link></li>
              <li><Link href="/careers" className="hover:text-white">Careers</Link></li>
              <li><Link href="/press" className="hover:text-white">Press</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-bold mb-4">Support</h3>
            <ul className="space-y-2">
              <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
              <li><Link href="/faq" className="hover:text-white">FAQ</Link></li>
              <li><Link href="/shipping" className="hover:text-white">Shipping</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-bold mb-4">Legal</h3>
            <ul className="space-y-2">
              <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-white">Terms</Link></li>
              <li><Link href="/cookies" className="hover:text-white">Cookies</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-bold mb-4">Follow</h3>
            <ul className="space-y-2">
              {settings?.tiktokUrl && (
                <li>
                  <a
                    href={settings.tiktokUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white"
                  >
                    TikTok
                  </a>
                </li>
              )}
              {settings?.facebookUrl && (
                <li>
                  <a
                    href={settings.facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white"
                  >
                    Facebook
                  </a>
                </li>
              )}
              {settings?.instagramUrl && (
                <li>
                  <a
                    href={settings.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white"
                  >
                    Instagram
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 pt-8 text-center">
          <p>{copyright}</p>
        </div>
      </div>
    </footer>
  );
}
