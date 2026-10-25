// File: app/layout.tsx

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Toaster } from "sonner";
import { CookieBanner } from "@/components/layout/CookieBanner";
import { Analytics } from "@vercel/analytics/react";
import { db as prisma } from "@/lib/db";
import { getStoreSettings, storeDisplayName } from "@/lib/store-settings";
import { getAppBaseUrl } from "@/lib/app-url";
import { SettingsProvider } from "@/components/providers/settings-provider";
import { StoreSettingsData } from "@/app/actions/settings";

const inter = Inter({ subsets: ["latin"] });

// Store settings and account-specific content must not be frozen at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getStoreSettings(prisma);
  const siteName = storeDisplayName(settings);
  const siteDescription = settings?.heroSubtitle || "Quality products at great prices";
  const faviconUrl = settings?.faviconUrl || null;
  const ogImageUrl = settings?.ogImageUrl || faviconUrl;
  const siteUrl = getAppBaseUrl();

  return {
    title: {
      default: siteName,
      template: `%s | ${siteName}`,
    },
    description: siteDescription,
    ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
    openGraph: {
      type: "website",
      locale: settings?.siteLang === "ru" ? "ru_RU" : "en_US",
      ...(siteUrl ? { url: siteUrl } : {}),
      title: siteName,
      description: siteDescription,
      ...(ogImageUrl ? { images: [{ url: ogImageUrl }] } : {}),
    },
    twitter: {
      card: ogImageUrl ? "summary_large_image" : "summary",
      title: siteName,
      description: siteDescription,
      ...(ogImageUrl ? { images: [ogImageUrl] } : {}),
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getStoreSettings(prisma);
  const siteLang = settings?.siteLang || "en";

  return (
    <html lang={siteLang} suppressHydrationWarning>
      <body className={inter.className}>
        <SessionProvider>
          <SettingsProvider initialSettings={settings as unknown as StoreSettingsData}>
            <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
              <div className="flex flex-col min-h-screen">
                <Navbar />
                <main className="flex-1">{children}</main>
                <Footer />
              </div>
              <Toaster />
            </ThemeProvider>
          </SettingsProvider>
        </SessionProvider>
        <CookieBanner />
        <Analytics />
      </body>
    </html>
  );
}
