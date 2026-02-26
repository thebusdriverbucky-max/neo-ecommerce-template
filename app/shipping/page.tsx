import { getPageBySlug } from "@/app/actions/cms";

export default async function ShippingPage() {
  const res = await getPageBySlug("shipping");

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
      <h1 className="text-4xl font-bold mb-6">Shipping Information</h1>

      <div className="space-y-6">
        <section>
          <h2 className="text-2xl font-semibold mb-3">Shipping Rates & Times</h2>
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="font-semibold mb-2">Standard Shipping</h3>
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                <strong>5-7 business days</strong> • $5.99
              </p>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Free on orders over $50
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="font-semibold mb-2">Express Shipping</h3>
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                <strong>2-3 business days</strong> • $14.99
              </p>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Available on most items
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <h3 className="font-semibold mb-2">Overnight Shipping</h3>
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                <strong>Next business day</strong> • $24.99
              </p>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Order before 2 PM for next day delivery
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Processing Time</h2>
          <p className="text-gray-700 dark:text-gray-300">
            Orders are processed within 1-2 business days. Processing times do not include weekends or holidays.
            You will receive a confirmation email with tracking information once your order ships.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Delivery Areas</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            We currently ship to:
          </p>
          <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
            <li>All 50 United States</li>
            <li>Canada</li>
            <li>Select European countries</li>
            <li>Australia and New Zealand</li>
          </ul>
          <p className="text-gray-700 dark:text-gray-300 mt-4">
            For international orders, additional customs fees may apply.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Tracking Your Order</h2>
          <p className="text-gray-700 dark:text-gray-300">
            Once your order ships, you will receive an email with a tracking number. You can use this number
            to track your package on the carrier's website (USPS, UPS, or FedEx).
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Damaged or Lost Packages</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            If your package arrives damaged or goes missing:
          </p>
          <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>Contact us immediately with photos of the damage</li>
            <li>Provide your order number and tracking information</li>
            <li>We will initiate a replacement or refund within 48 hours</li>
          </ol>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Contact Us</h2>
          <p className="text-gray-700 dark:text-gray-300">
            For shipping questions, contact us at:{" "}
            <a href="mailto:shipping@store.com" className="text-blue-600 hover:underline">
              shipping@store.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
