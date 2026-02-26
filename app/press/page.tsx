export default function PressPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">Press & Media</h1>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-3">Media Kit</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Welcome to our press page. Here you'll find everything you need to cover our story,
            including logos, product images, and company information.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Company Overview</h2>
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              <strong>Founded:</strong> 2024
            </p>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              <strong>Headquarters:</strong> United States
            </p>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              <strong>Industry:</strong> E-commerce / Retail
            </p>
            <p className="text-gray-700 dark:text-gray-300">
              We're a modern e-commerce platform committed to providing quality products and exceptional
              customer service. Our mission is to make online shopping accessible, affordable, and enjoyable
              for everyone.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Recent News</h2>
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">January 2026</p>
              <h3 className="font-semibold mb-2">Platform Launch & Expansion</h3>
              <p className="text-gray-700 dark:text-gray-300">
                Successfully launched our enhanced e-commerce platform with improved user experience
                and expanded product catalog.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">December 2025</p>
              <h3 className="font-semibold mb-2">Milestone: 10,000 Customers Served</h3>
              <p className="text-gray-700 dark:text-gray-300">
                Reached a significant milestone of serving over 10,000 satisfied customers across
                50 countries worldwide.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Brand Assets</h2>
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              For logo files, brand guidelines, and high-resolution images, please contact our press team.
            </p>
            <ul className="space-y-2 text-gray-700 dark:text-gray-300">
              <li className="flex items-center gap-2">
                <span className="text-blue-600">•</span>
                Company logos (PNG, SVG)
              </li>
              <li className="flex items-center gap-2">
                <span className="text-blue-600">•</span>
                Product photography
              </li>
              <li className="flex items-center gap-2">
                <span className="text-blue-600">•</span>
                Brand color palette
              </li>
              <li className="flex items-center gap-2">
                <span className="text-blue-600">•</span>
                Executive headshots
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Press Inquiries</h2>
          <div className="bg-blue-50 dark:bg-blue-900 rounded-lg border border-blue-200 dark:border-blue-800 p-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              For press inquiries, interviews, or media requests, please contact:
            </p>
            <p className="font-semibold text-gray-900 dark:text-white mb-1">Press Contact</p>
            <a
              href="mailto:press@store.com"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              press@store.com
            </a>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-4">
              We typically respond within 24-48 hours on business days.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Media Coverage</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            We've been featured in various publications. For a complete list of press coverage
            and interviews, please contact our press team.
          </p>
        </section>
      </div>
    </div>
  );
}
