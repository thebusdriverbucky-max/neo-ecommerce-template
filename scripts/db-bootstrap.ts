import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS_ID = 'default';

const pages = [
  { slug: 'careers', title: 'Careers', content: '<h1>Careers</h1><p>Join our team!</p>' },
  { slug: 'press', title: 'Press', content: '<h1>Press</h1><p>Latest news and press releases.</p>' },
  { slug: 'support', title: 'Support', content: '<h1>Support</h1><p>How can we help you?</p>' },
  { slug: 'contact', title: 'Contact', content: '<h1>Contact Us</h1><p>Get in touch with us.</p>' },
  { slug: 'faq', title: 'FAQ', content: '<h1>Frequently Asked Questions</h1><p>Find answers to common questions.</p>' },
  { slug: 'legal', title: 'Legal', content: 'Replace this starter text with the legal notices required for your business, products, and jurisdiction before launch.' },
  { slug: 'cookies', title: 'Cookie Policy', content: 'Replace this starter text with a cookie policy that reflects the analytics, authentication, payment, and other services enabled on your deployment before launch.' },
  { slug: 'shipping', title: 'Shipping Policy', content: 'Replace this starter text with your actual delivery regions, methods, prices, timing, returns, and contact process before accepting orders.' },
  { slug: 'terms', title: 'Terms of Service', content: 'Replace this starter text with terms reviewed for your business, products, pricing, fulfillment, cancellation, return, refund, and jurisdiction requirements before launch.' },
  { slug: 'about', title: 'About', content: '<h1>About Us</h1><p>Learn more about our store.</p>' },
  { slug: 'privacy', title: 'Privacy Policy', content: 'Replace this starter text with a privacy policy reviewed for the account, order, delivery, analytics, authentication, payment, and other personal data your deployment processes before launch.' },
];

async function main() {
  console.log('Bootstrapping required store data...');

  const existingSettings = await prisma.storeSettings.findFirst({
    select: { id: true },
  });

  if (!existingSettings) {
    await prisma.storeSettings.upsert({
      where: { id: DEFAULT_SETTINGS_ID },
      update: {},
      create: {
        id: DEFAULT_SETTINGS_ID,
        currency: 'USD',
        taxRate: 0,
        shippingCost: 0,
        freeShippingThreshold: 500,
        enabledCountries: [],
        enabledCategories: [],
      },
    });
    console.log('Created default store settings.');
  } else {
    console.log('Store settings already exist; leaving them unchanged.');
  }

  for (const page of pages) {
    await prisma.contentPage.upsert({
      where: { slug: page.slug },
      update: {},
      create: {
        ...page,
        isVisible: true,
      },
    });
  }
  console.log('Required store data is ready. Existing content was not changed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
