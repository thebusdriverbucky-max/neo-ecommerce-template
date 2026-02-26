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
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <div className="prose dark:prose-invert max-w-none space-y-6">
        <section>
          <h2 className="text-2xl font-semibold mb-3">Agreement to Terms</h2>
          <p>
            By accessing and using this website, you accept and agree to be bound by the terms
            and provision of this agreement.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Use License</h2>
          <p>
            Permission is granted to temporarily download one copy of the materials (information
            or software) on our website for personal, non-commercial transitory viewing only.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Product Information</h2>
          <ul className="list-disc list-inside space-y-2">
            <li>All product descriptions are accurate to the best of our knowledge</li>
            <li>Prices are subject to change without notice</li>
            <li>We reserve the right to limit quantities</li>
            <li>Products are subject to availability</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Refund Policy</h2>
          <p>
            Products may be returned within 30 days of purchase in original condition for a full
            refund. Shipping costs are non-refundable. Please contact our support team to
            initiate a return.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Limitation of Liability</h2>
          <p>
            In no event shall our company be liable for any damages (including, without limitation,
            damages for loss of data or profit, or due to business interruption) arising out of the
            use or inability to use the materials on our website.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Changes to Terms</h2>
          <p>
            We reserve the right to modify or amend these terms at any time. Your continued use of
            the website following the posting of revised Terms means that you accept and agree to
            the changes.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Contact Us</h2>
          <p>
            If you have any questions about these Terms, please contact us at:{" "}
            <a href="mailto:support@store.com" className="text-blue-600 hover:underline">
              support@store.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
