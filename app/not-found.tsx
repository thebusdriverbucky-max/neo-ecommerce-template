import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container mx-auto px-4 py-16 text-center">
      <div className="max-w-md mx-auto">
        <h1 className="text-6xl font-bold mb-4">404</h1>
        <h2 className="text-2xl font-semibold mb-4">Page Not Found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Sorry, we couldn't find the page you're looking for. It might have been moved or deleted.
        </p>
        <div className="space-y-3">
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go Home
          </Link>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            or{" "}
            <Link href="/products" className="text-blue-600 hover:underline">
              browse products
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
