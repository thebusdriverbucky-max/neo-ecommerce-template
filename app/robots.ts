import { MetadataRoute } from "next";
import { getAppBaseUrl } from "@/lib/app-url";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getAppBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /_next stays crawlable: search engines need the CSS and JS to render pages.
      disallow: ["/admin", "/api", "/dashboard"],
    },
    // Without NEXT_PUBLIC_APP_URL the sitemap URL is unknown, so it is left out.
    ...(baseUrl ? { sitemap: `${baseUrl}/sitemap.xml` } : {}),
  };
}
