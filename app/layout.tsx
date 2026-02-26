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

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "E-Commerce Store | Quality Products",
  description: "Browse and shop our curated collection of quality products",
  icons: {
    icon: "https://i.imgur.com/udCYp7c.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://neo-e-commerce.vercel.app",
    title: "E-Commerce Store",
    description: "Quality products at great prices",
    images: [{ url: "https://i.imgur.com/udCYp7c.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "E-Commerce Store",
    description: "Quality products at great prices",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <SessionProvider>
          <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
            <div className="flex flex-col min-h-screen">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster />
          </ThemeProvider>
        </SessionProvider>
        <CookieBanner />
        <Analytics />
      </body>
    </html>
  );
}
