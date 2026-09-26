import { getPageBySlug } from "@/app/actions/cms";

export default async function TermsPage() {
  const res = await getPageBySlug("terms");

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

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">Terms of Service</h1>
      <p className="prose dark:prose-invert max-w-none">
        Replace this starter text with terms reviewed for your business, products,
        pricing, fulfillment, cancellation, return, refund, and jurisdiction
        requirements before launch.
      </p>
    </div>
  );
}
