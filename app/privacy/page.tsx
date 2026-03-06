import { getPageBySlug } from "@/app/actions/cms";
import { notFound } from "next/navigation";

export default async function PrivacyPage() {
  const res = await getPageBySlug("privacy");

  if (!res.success || !res.data || !res.data.isVisible) {
    // Fallback to static content if not in DB or hidden
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Last updated: {new Date().toLocaleDateString("en-US")}
        </p>

        <div className="prose dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-2xl font-semibold mb-3">Introduction</h2>
            <p>
              We respect your privacy and are committed to protecting your personal data.
              This privacy policy explains how we collect, use, and protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">Information We Collect</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Name and email address (for account creation)</li>
              <li>Payment information (processed by Stripe - we don't store it)</li>
              <li>Shipping address (for orders)</li>
              <li>Usage data (cookies, analytics)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">How We Use Your Data</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Process and fulfill orders</li>
              <li>Send order confirmations and shipping updates</li>
              <li>Improve our website and services</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">Payment Security</h2>
            <p>
              Payment information is processed securely by Stripe. We do not store credit card
              information on our servers. All transactions are encrypted and PCI-DSS compliant.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Access your personal data</li>
              <li>Request deletion of your data</li>
              <li>Opt-out of marketing emails</li>
              <li>Port your data to another service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">Contact Us</h2>
            <p>
              For privacy concerns, email us at:{" "}
              <a href="mailto:privacy@store.com" className="text-blue-600 hover:underline">
                privacy@store.com
              </a>
            </p>
          </section>
        </div>
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
