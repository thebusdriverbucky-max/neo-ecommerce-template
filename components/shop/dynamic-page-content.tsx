import { getPageBySlug } from "@/app/actions/cms";
import { notFound } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";
import { defaultCMSPage } from "@/lib/cms-defaults";
import type { ReactNode } from "react";

export default async function DynamicCMSPage({ params, children }: { params: { slug: string }; children?: ReactNode }) {
  const res = await getPageBySlug(params.slug);

  if (!res.success) throw new Error("Page content is temporarily unavailable. Please try again.");
  const page = res.data ?? defaultCMSPage(params.slug);
  if (!page || !page.isVisible) notFound();

  const sanitizedContent = DOMPurify.sanitize(page.content, { USE_PROFILES: { html: true } });

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">{page.title}</h1>
      <div
        className="prose dark:prose-invert max-w-none whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: sanitizedContent }}
      />
      {children}
    </div>
  );
}
