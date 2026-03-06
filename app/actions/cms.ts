'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export interface ContentPageData {
  slug: string;
  title: string;
  content: string;
  isVisible: boolean;
}

export async function getPages() {
  try {
    const pages = await prisma.contentPage.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: pages };
  } catch (error) {
    console.error('Error fetching pages:', error);
    return { success: false, error: 'Failed to fetch pages' };
  }
}

export async function getPageBySlug(slug: string) {
  try {
    const page = await prisma.contentPage.findUnique({
      where: { slug },
    });
    return { success: true, data: page };
  } catch (error) {
    console.error('Error fetching page:', error);
    return { success: false, error: 'Failed to fetch page' };
  }
}

export async function updatePage(id: string, data: Partial<ContentPageData>) {
  try {
    await prisma.contentPage.update({
      where: { id },
      data,
    });
    revalidatePath('/admin/settings');
    return { success: true };
  } catch (error) {
    console.error('Error updating page:', error);
    return { success: false, error: 'Failed to update page' };
  }
}

export async function createPage(data: ContentPageData) {
  try {
    await prisma.contentPage.create({
      data,
    });
    revalidatePath('/admin/settings');
    return { success: true };
  } catch (error) {
    console.error('Error creating page:', error);
    return { success: false, error: 'Failed to create page' };
  }
}

export async function togglePageVisibility(id: string, isVisible: boolean) {
  try {
    await prisma.contentPage.update({
      where: { id },
      data: { isVisible },
    });
    revalidatePath('/admin/settings');
    return { success: true };
  } catch (error) {
    console.error('Error toggling page visibility:', error);
    return { success: false, error: 'Failed to toggle page visibility' };
  }
}

export async function seedCMSPages() {
  const pages = [
    {
      slug: "about",
      title: "About Us",
      content: `Our Story
Founded in 2024, our e-commerce platform was built with a simple mission: to provide high-quality products and exceptional customer service. We believe in transparency, reliability, and customer satisfaction.

What started as a small project has grown into a thriving marketplace serving thousands of customers worldwide. We're committed to continuous improvement and innovation.

Our Mission
To make online shopping easy, affordable, and enjoyable for everyone. We strive to offer:
• Quality Products: Carefully curated selection of items
• Competitive Prices: Best value for your money
• Fast Shipping: Quick delivery to your doorstep
• Great Support: Responsive customer service

Our Values
Integrity: We believe in honest communication and transparent practices with our customers.
Excellence: We strive for excellence in everything we do, from product quality to customer service.
Innovation: We continuously improve and innovate to better serve our customers.
Community: We value our customers and aim to build a thriving community around our brand.`,
    },
    {
      slug: "faq",
      title: "Frequently Asked Questions",
      content: `Q: How long does shipping take?
A: Standard shipping takes 5-7 business days, Express takes 2-3 business days, and Overnight is delivered the next business day. Processing time is 1-2 business days before your order ships.

Q: What is your return policy?
A: We offer a 30-day return guarantee on all products in original condition. Simply contact us to initiate a return. Original shipping costs are non-refundable, but we cover return shipping.

Q: Do you offer international shipping?
A: Yes, we ship to Canada, select European countries, Australia, and New Zealand. International orders may incur additional customs fees.

Q: How can I track my order?
A: You will receive a tracking number via email once your order ships. Use this number to track your package on the carrier website (USPS, UPS, or FedEx).

Q: What payment methods do you accept?
A: We accept all major credit cards (Visa, Mastercard, American Express), Apple Pay, Google Pay, and PayPal through our secure Stripe payment processor.

Q: Is my payment information secure?
A: Yes. We use Stripe for payment processing, which is PCI-DSS compliant. We never store credit card information on our servers.

Q: Can I cancel my order?
A: If your order hasn't shipped yet, we can usually cancel it. Please contact us immediately with your order number.

Q: How do I reset my password?
A: Click "Forgot Password" on the login page and enter your email. You'll receive a link to reset your password within minutes.

Q: Can I modify my order after placing it?
A: Orders can be modified within the first 2 hours. After that, please contact us and we'll do our best to help.

Q: What if I receive a damaged item?
A: Contact us immediately with photos of the damage and your order number. We will send a replacement or issue a full refund within 48 hours.`,
    },
    {
      slug: "terms",
      title: "Terms of Service",
      content: `Agreement to Terms
By accessing and using this website, you accept and agree to be bound by the terms and provision of this agreement.

Use License
Permission is granted to temporarily download one copy of the materials (information or software) on our website for personal, non-commercial transitory viewing only.

Product Information
• All product descriptions are accurate to the best of our knowledge
• Prices are subject to change without notice
• We reserve the right to limit quantities
• Products are subject to availability

Refund Policy
Products may be returned within 30 days of purchase in original condition for a full refund. Shipping costs are non-refundable. Please contact our support team to initiate a return.

Limitation of Liability
In no event shall our company be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on our website.

Changes to Terms
We reserve the right to modify or amend these terms at any time. Your continued use of the website following the posting of revised Terms means that you accept and agree to the changes.`,
    },
    {
      slug: "privacy",
      title: "Privacy Policy",
      content: `Introduction
We respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and protect your information.

Information We Collect
• Name and email address (for account creation)
• Payment information (processed by Stripe - we don't store it)
• Shipping address (for orders)
• Usage data (cookies, analytics)

How We Use Your Data
• Process and fulfill orders
• Send order confirmations and shipping updates
• Improve our website and services
• Comply with legal obligations

Payment Security
Payment information is processed securely by Stripe. We do not store credit card information on our servers. All transactions are encrypted and PCI-DSS compliant.

Your Rights
You have the right to:
• Access your personal data
• Request deletion of your data
• Opt-out of marketing emails
• Port your data to another service`,
    },
    {
      slug: "shipping",
      title: "Shipping Information",
      content: `Shipping Rates & Times
Standard Shipping: 5-7 business days • $5.99 (Free on orders over $50)
Express Shipping: 2-3 business days • $14.99
Overnight Shipping: Next business day • $24.99 (Order before 2 PM)

Processing Time
Orders are processed within 1-2 business days. Processing times do not include weekends or holidays. You will receive a confirmation email with tracking information once your order ships.

Delivery Areas
We currently ship to:
• All 50 United States
• Canada
• Select European countries
• Australia and New Zealand

Tracking Your Order
Once your order ships, you will receive an email with a tracking number. You can use this number to track your package on the carrier's website (USPS, UPS, or FedEx).

Damaged or Lost Packages
If your package arrives damaged or goes missing:
1. Contact us immediately with photos of the damage
2. Provide your order number and tracking information
3. We will initiate a replacement or refund within 48 hours`,
    },
    {
      slug: "cookies",
      title: "Cookie Policy",
      content: `What Are Cookies?
Cookies are small text files that are stored on your computer or mobile device when you visit our website. They help us remember your preferences and understand how you use our site.

Types of Cookies We Use
Essential Cookies: Required for the website to function properly.
Analytics Cookies: Help us understand how visitors use our website.
Preference Cookies: Remember your choices (dark mode, language, etc.).
Marketing Cookies: Used for targeted advertising purposes.

Managing Cookies
You can control and manage cookies through your browser settings. Most browsers allow you to view, delete, or block cookies.

Third-Party Services
We use third-party services that may set their own cookies:
• Stripe: Payment processing
• Google Analytics: Website analytics
• NextAuth: Authentication`,
    },
    {
      slug: "careers",
      title: "Careers",
      content: `Join Our Team
We're always looking for talented individuals to join our growing team. If you're passionate about e-commerce and technology, we'd love to hear from you.

Current Openings
Full Stack Developer (Remote • Full-time): Expertise in Next.js, TypeScript, and React.
Product Manager (Remote • Full-time): Strategic product decisions and roadmap planning.
Customer Support Specialist (Remote • Full-time): Help our customers have amazing experiences.

Why Work With Us?
• Competitive Salary
• Remote-First
• Health Benefits
• Professional Growth`,
    },
    {
      slug: "contact",
      title: "Contact Us",
      content: `Have a question? We'd love to hear from you. Send us a message and we'll get back to you as soon as possible.

Email: support@store.com
Response Time: 24-48 hours
Hours: Mon-Fri, 9 AM-6 PM EST`,
    },
  ];

  try {
    for (const page of pages) {
      await prisma.contentPage.upsert({
        where: { slug: page.slug },
        update: {
          title: page.title,
          content: page.content,
        },
        create: {
          ...page,
          isVisible: true,
        },
      });
    }
    return { success: true };
  } catch (error) {
    console.error('Error seeding CMS pages:', error);
    return { success: false, error: 'Failed to seed CMS pages' };
  }
}
