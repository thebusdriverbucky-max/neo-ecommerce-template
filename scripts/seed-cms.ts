import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const pages = [
  { slug: 'careers', title: 'Careers', content: '<h1>Careers</h1><p>Join our team!</p>' },
  { slug: 'press', title: 'Press', content: '<h1>Press</h1><p>Latest news and press releases.</p>' },
  { slug: 'support', title: 'Support', content: '<h1>Support</h1><p>How can we help you?</p>' },
  { slug: 'contact', title: 'Contact', content: '<h1>Contact Us</h1><p>Get in touch with us.</p>' },
  { slug: 'faq', title: 'FAQ', content: '<h1>Frequently Asked Questions</h1><p>Find answers to common questions.</p>' },
  { slug: 'legal', title: 'Legal', content: '<h1>Legal</h1><p>Legal information.</p>' },
  { slug: 'cookies', title: 'Cookies', content: '<h1>Cookie Policy</h1><p>Information about cookies.</p>' },
  { slug: 'shipping', title: 'Shipping', content: '<h1>Shipping Policy</h1><p>Information about shipping.</p>' },
  { slug: 'terms', title: 'Terms', content: '<h1>Terms of Service</h1><p>Our terms and conditions.</p>' },
  { slug: 'about', title: 'About', content: '<h1>About Us</h1><p>Learn more about our store.</p>' },
  { slug: 'privacy', title: 'Privacy', content: '<h1>Privacy Policy</h1><p>How we handle your data.</p>' },
];

async function main() {
  console.log('Seeding CMS pages...');
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
  console.log('CMS pages seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
