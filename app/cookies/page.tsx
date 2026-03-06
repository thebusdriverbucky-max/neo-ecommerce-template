export default function CookiesPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">Cookie Policy</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        Last updated: {new Date().toLocaleDateString("en-US")}
      </p>

      <div className="space-y-6">
        <section>
          <h2 className="text-2xl font-semibold mb-3">What Are Cookies?</h2>
          <p className="text-gray-700 dark:text-gray-300">
            Cookies are small text files that are stored on your computer or mobile device when you visit our website.
            They help us remember your preferences and understand how you use our site.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Types of Cookies We Use</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Essential Cookies</h3>
              <p className="text-gray-700 dark:text-gray-300">
                Required for the website to function properly. These include authentication and security cookies.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Analytics Cookies</h3>
              <p className="text-gray-700 dark:text-gray-300">
                Help us understand how visitors use our website. We use Google Analytics to track usage patterns.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Preference Cookies</h3>
              <p className="text-gray-700 dark:text-gray-300">
                Remember your choices (dark mode, language, etc.) to personalize your experience.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Marketing Cookies</h3>
              <p className="text-gray-700 dark:text-gray-300">
                Used to track your activity across websites for targeted advertising purposes.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Managing Cookies</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            You can control and manage cookies through your browser settings. Most browsers allow you to:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>View what cookies are set</li>
            <li>Delete existing cookies</li>
            <li>Block cookies from being set</li>
            <li>Disable cookies for specific sites</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Third-Party Services</h2>
          <p className="text-gray-700 dark:text-gray-300">
            We use third-party services that may set their own cookies:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300 mt-3">
            <li><strong>Google Analytics:</strong> Website analytics</li>
            <li><strong>NextAuth:</strong> Authentication</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Contact Us</h2>
          <p className="text-gray-700 dark:text-gray-300">
            If you have questions about our cookie policy, email us at:{" "}
            <a href="mailto:privacy@store.com" className="text-blue-600 hover:underline">
              privacy@store.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
