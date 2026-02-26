import { getPageBySlug } from "@/app/actions/cms";
import FAQContent from "./faq-content";

export default async function FAQPage() {
  const res = await getPageBySlug("faq");

  if (res.success && res.data && res.data.isVisible) {
    const page = res.data;
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-4xl font-bold mb-6">{page.title}</h1>
        <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap">
          {page.content}
        </div>
      </div>
    );
  }

  return <FAQContent />;
}
