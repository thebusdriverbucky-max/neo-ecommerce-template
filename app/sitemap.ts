import { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { CMS_DEFAULT_PAGES } from "@/lib/cms-defaults";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SitemapProduct = {
  slug: string;
  updatedAt: Date;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://neo-e-commerce.vercel.app";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/products`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },

  ];

  const savedPages = await db.contentPage.findMany({
    select: { slug: true, isVisible: true, updatedAt: true },
  });
  const cmsPages: MetadataRoute.Sitemap = CMS_DEFAULT_PAGES.flatMap(page => {
    const saved = savedPages.find(candidate => candidate.slug === page.slug);
    return saved?.isVisible === false ? [] : [{
      url: `${baseUrl}/${page.slug}`,
      lastModified: saved?.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }];
  });

  // Dynamic product pages
  const products = await db.product.findMany({
    where: { isArchived: false },
    select: { slug: true, updatedAt: true },
  });

  const productPages: MetadataRoute.Sitemap = products.map((product: SitemapProduct) => ({
    url: `${baseUrl}/products/${product.slug}`,
    lastModified: product.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...cmsPages, ...productPages];
}
