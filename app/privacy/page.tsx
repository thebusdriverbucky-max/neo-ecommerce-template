import { getPageBySlug } from "@/app/actions/cms";
import { notFound } from "next/navigation";

export default async function PrivacyPage() {
  const res = await getPageBySlug("privacy");

  if (!res.success || !res.data || !res.data.isVisible) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
        <p className="prose dark:prose-invert max-w-none">
          Replace this starter text with a privacy policy reviewed for the account,
          order, delivery, analytics, authentication, payment, and other personal
          data your deployment processes before launch.
        </p>
      </div>
    );
  }

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
