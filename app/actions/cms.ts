'use server';

import { db as prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { CMS_SLUGS, ensureCMSPages } from '@/lib/cms-defaults';
import { z } from 'zod';

const pageSchema = z.object({
  slug: z.string().refine(value => CMS_SLUGS.includes(value), 'Unsupported page route'),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100000),
  isVisible: z.boolean(),
}).strict();

export interface ContentPageData {
  slug: string;
  title: string;
  content: string;
  isVisible: boolean;
}

export async function getPages() {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") return { success: false, error: 'Unauthorized' };
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
    // Public reads must not expose the text of unpublished pages.
    return { success: true, data: page?.isVisible === false ? { slug: page.slug, title: "", content: "", isVisible: false } : page };
  } catch (error) {
    console.error('Error fetching page:', error);
    return { success: false, error: 'Failed to fetch page' };
  }
}

export async function updatePage(id: string, data: Partial<ContentPageData>) {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") return { success: false, error: 'Unauthorized' };

    const parsed = pageSchema.partial().safeParse(data);
    if (!parsed.success) return { success: false, error: 'Invalid page fields' };
    const existing = await prisma.contentPage.findUnique({ where: { id } });
    if (!existing || (parsed.data.slug !== undefined && parsed.data.slug !== existing.slug)) {
      return { success: false, error: 'Page routes cannot be renamed' };
    }
    await prisma.contentPage.update({ where: { id }, data: parsed.data });
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    console.error('Error updating page:', error);
    return { success: false, error: 'Failed to update page' };
  }
}

export async function createPage(data: ContentPageData) {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") return { success: false, error: 'Unauthorized' };

    const parsed = pageSchema.safeParse(data);
    if (!parsed.success) return { success: false, error: 'Invalid page fields or unsupported route' };
    await prisma.contentPage.create({ data: parsed.data });
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    console.error('Error creating page:', error);
    return { success: false, error: 'Failed to create page' };
  }
}

export async function togglePageVisibility(id: string, isVisible: boolean) {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") return { success: false, error: 'Unauthorized' };

    if (typeof isVisible !== 'boolean') return { success: false, error: 'Invalid visibility' };
    await prisma.contentPage.update({
      where: { id },
      data: { isVisible },
    });
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    console.error('Error toggling page visibility:', error);
    return { success: false, error: 'Failed to toggle page visibility' };
  }
}

export async function seedCMSPages() {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") return { success: false, error: 'Unauthorized' };
    await ensureCMSPages(prisma);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to add missing CMS pages' };
  }
}
