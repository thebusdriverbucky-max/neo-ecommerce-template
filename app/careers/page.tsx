export default function CareersPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-6">Careers</h1>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-3">Join Our Team</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            We're always looking for talented individuals to join our growing team. If you're passionate about
            e-commerce and technology, we'd love to hear from you.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Current Openings</h2>
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Full Stack Developer</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Remote • Full-time</p>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                We're looking for an experienced Full Stack Developer with expertise in Next.js, TypeScript, and React.
              </p>
              <a href="mailto:careers@store.com" className="text-blue-600 dark:text-blue-400 hover:underline">
                Apply Now →
              </a>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Product Manager</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Remote • Full-time</p>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Help us build the future of e-commerce with strategic product decisions and roadmap planning.
              </p>
              <a href="mailto:careers@store.com" className="text-blue-600 dark:text-blue-400 hover:underline">
                Apply Now →
              </a>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
              <h3 className="font-semibold mb-2">Customer Support Specialist</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Remote • Full-time</p>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Be the first point of contact for our customers and help them have amazing experiences.
              </p>
              <a href="mailto:careers@store.com" className="text-blue-600 dark:text-blue-400 hover:underline">
                Apply Now →
              </a>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Why Work With Us?</h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="text-green-600 font-bold mt-1">✓</span>
              <div>
                <h4 className="font-semibold">Competitive Salary</h4>
                <p className="text-gray-600 dark:text-gray-400 text-sm">Market-competitive compensation</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-600 font-bold mt-1">✓</span>
              <div>
                <h4 className="font-semibold">Remote-First</h4>
                <p className="text-gray-600 dark:text-gray-400 text-sm">Work from anywhere</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-600 font-bold mt-1">✓</span>
              <div>
                <h4 className="font-semibold">Health Benefits</h4>
                <p className="text-gray-600 dark:text-gray-400 text-sm">Comprehensive coverage</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-600 font-bold mt-1">✓</span>
              <div>
                <h4 className="font-semibold">Professional Growth</h4>
                <p className="text-gray-600 dark:text-gray-400 text-sm">Learning opportunities and mentorship</p>
              </div>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Contact Us</h2>
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            Didn't find a position that fits? Send us your resume and we'll keep it on file.
          </p>
          <a
            href="mailto:careers@store.com"
            className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
          >
            careers@store.com
          </a>
        </section>
      </div>
    </div>
  );
}
