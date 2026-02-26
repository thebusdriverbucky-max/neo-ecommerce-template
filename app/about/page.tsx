import { getPageBySlug } from "@/app/actions/cms";

export default async function AboutPage() {
  const res = await getPageBySlug("about");

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
      <h1 className="text-4xl font-bold mb-6">About Us</h1>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-3">Our Story</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Founded in 2024, our e-commerce platform was built with a simple mission: to provide high-quality
            products and exceptional customer service. We believe in transparency, reliability, and customer satisfaction.
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            What started as a small project has grown into a thriving marketplace serving thousands of customers worldwide.
            We're committed to continuous improvement and innovation.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Our Mission</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            To make online shopping easy, affordable, and enjoyable for everyone. We strive to offer:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-3">
              <span className="text-blue-600 font-bold">•</span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong>Quality Products:</strong> Carefully curated selection of items
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-600 font-bold">•</span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong>Competitive Prices:</strong> Best value for your money
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-600 font-bold">•</span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong>Fast Shipping:</strong> Quick delivery to your doorstep
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-600 font-bold">•</span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong>Great Support:</strong> Responsive customer service
              </span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Integrity</h3>
              <p className="text-gray-700 dark:text-gray-300 text-sm">
                We believe in honest communication and transparent practices with our customers.
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Excellence</h3>
              <p className="text-gray-700 dark:text-gray-300 text-sm">
                We strive for excellence in everything we do, from product quality to customer service.
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Innovation</h3>
              <p className="text-gray-700 dark:text-gray-300 text-sm">
                We continuously improve and innovate to better serve our customers.
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Community</h3>
              <p className="text-gray-700 dark:text-gray-300 text-sm">
                We value our customers and aim to build a thriving community around our brand.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">By The Numbers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6">
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">10K+</p>
              <p className="text-gray-700 dark:text-gray-300 mt-2">Happy Customers</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900 rounded-lg p-6">
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">500+</p>
              <p className="text-gray-700 dark:text-gray-300 mt-2">Products Available</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-6">
              <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">50+</p>
              <p className="text-gray-700 dark:text-gray-300 mt-2">Countries Served</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Get In Touch</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            Have questions about our company? We'd love to hear from you!
          </p>
          <a
            href="/contact"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Contact Us
          </a>
        </section>
      </div>
    </div>
  );
}
