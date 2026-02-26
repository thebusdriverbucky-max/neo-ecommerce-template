import { getPageBySlug } from "@/app/actions/cms";
import { notFound } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";

interface PageProps {
  params: {
    slug: string;
  };
}

export default async function DynamicCMSPage({ params }: { params: { slug: string } }) {
  // This is a generic component for pages like /about, /careers, etc.
  // But since they are in separate folders, we might need to update each or use a catch-all route.
  // For now, I will create a reusable component and use it in the specific page files.

  const res = await getPageBySlug(params.slug);

  if (!res.success || !res.data || !res.data.isVisible) {
    notFound();
  }

  const page = res.data;
  const sanitizedContent = DOMPurify.sanitize(page.content);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">{page.title}</h1>
      <div
        className="prose dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: sanitizedContent }}
      />
    </div>
  );
}

