import type { PrismaClient } from "@prisma/client";

export const CMS_DEFAULT_PAGES = [
  { slug: 'careers', title: 'Careers', content: 'Publish your current opportunities and application process here.' },
  { slug: 'press', title: 'Press', content: 'Publish your store news and press contact here.' },
  { slug: 'support', title: 'Support', content: 'Contact us for help with your order.' },
  { slug: 'contact', title: 'Contact', content: 'Have a question? Send us a message using the form below.' },
  { slug: 'faq', title: 'FAQ', content: 'Payment is by bank transfer only. Use the bank details provided by the store. The store verifies receipt manually; placing an order does not confirm payment. Publish your shipping, return and support policies here.' },
  { slug: 'legal', title: 'Legal', content: 'Replace this starter text with the legal notices required for your business, products, and jurisdiction before launch.' },
  { slug: 'cookies', title: 'Cookie Policy', content: 'Replace this starter text with a cookie policy that reflects the analytics, authentication, payment, and other services enabled on your deployment before launch.' },
  { slug: 'shipping', title: 'Shipping Policy', content: 'Replace this starter text with your actual delivery regions, methods, prices, timing, returns, and contact process before accepting orders.' },
  { slug: 'terms', title: 'Terms of Service', content: 'Payment is by bank transfer only and is verified manually by the store. Replace this starter text with terms reviewed for your business, products, pricing, fulfillment, cancellation, return, refund, and jurisdiction requirements before launch.' },
  { slug: 'about', title: 'About', content: 'Tell your customers about your store, products and team here.' },
  { slug: 'privacy', title: 'Privacy Policy', content: 'Replace this starter text with a privacy policy reviewed for the account, order, delivery, analytics, authentication, payment, and other personal data your deployment processes before launch.' },
];

export const CMS_SLUGS = CMS_DEFAULT_PAGES.map(page => page.slug);

export function defaultCMSPage(slug: string) {
  const page = CMS_DEFAULT_PAGES.find(page => page.slug === slug);
  return page ? { ...page, isVisible: true } : null;
}

// The same create-only upserts serve baseline provisioning and admin repair.
export async function ensureCMSPages(db: Pick<PrismaClient, "contentPage">) {
  for (const page of CMS_DEFAULT_PAGES) {
    await db.contentPage.upsert({
      where: { slug: page.slug },
      update: {},
      create: { ...page, isVisible: true },
    });
  }
}
