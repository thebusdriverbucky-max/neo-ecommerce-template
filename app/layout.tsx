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
import { SettingsProvider } from "@/components/providers/settings-provider";
import { StoreSettingsData } from "@/app/actions/settings";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const settings = await prisma.storeSettings.findFirst();
  const siteName = settings?.storeName || "My Store";
  const siteDescription = settings?.heroSubtitle || "Quality products at great prices";
  const faviconUrl = settings?.faviconUrl || "https://i.imgur.com/udCYp7c.png";
  const ogImageUrl = settings?.ogImageUrl || faviconUrl;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://neo-e-commerce.vercel.app";

  return {
    title: {
      default: siteName,
      template: `%s | ${siteName}`,
    },
    description: siteDescription,
    icons: {
      icon: faviconUrl,
    },
    openGraph: {
      type: "website",
      locale: settings?.siteLang === "ru" ? "ru_RU" : "en_US",
      url: siteUrl,
      title: siteName,
      description: siteDescription,
      images: [{ url: ogImageUrl }],
    },
    twitter: {
      card: "summary_large_image",
      title: siteName,
      description: siteDescription,
      images: [ogImageUrl],
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await prisma.storeSettings.findFirst();
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
