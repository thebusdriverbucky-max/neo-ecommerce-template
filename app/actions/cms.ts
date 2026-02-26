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
    { slug: 'careers', title: 'Careers', content: '<h1>Careers</h1><p>Join our team!</p>' },
    { slug: 'press', title: 'Press', content: '<h1>Press</h1><p>Latest news and press releases.</p>' },
    { slug: 'contact', title: 'Contact', content: '<h1>Contact Us</h1><p>Get in touch with us.</p>' },
    { slug: 'faq', title: 'FAQ', content: '<h1>Frequently Asked Questions</h1><p>Find answers to common questions.</p>' },
    { slug: 'cookies', title: 'Cookies', content: '<h1>Cookie Policy</h1><p>Information about cookies.</p>' },
    { slug: 'shipping', title: 'Shipping', content: '<h1>Shipping Policy</h1><p>Information about shipping.</p>' },
    { slug: 'terms', title: 'Terms', content: '<h1>Terms of Service</h1><p>Our terms and conditions.</p>' },
    { slug: 'about', title: 'About', content: '<h1>About Us</h1><p>Learn more about our store.</p>' },
    { slug: 'privacy', title: 'Privacy', content: '<h1>Privacy Policy</h1><p>How we handle your data.</p>' },
  ];

  try {
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
    return { success: true };
  } catch (error) {
    console.error('Error seeding CMS pages:', error);
    return { success: false, error: 'Failed to seed CMS pages' };
  }
}
