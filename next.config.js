// File: next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // JSDOM reads assets relative to its installed files. Externalize the
    // whole sanitizer so nested JSDOM versions are not bundled into .next.
    serverComponentsExternalPackages: ["isomorphic-dompurify"],
  },
  images: {
    // Hosts served through the built-in image optimizer. Images from any other
    // HTTPS host still work: StoreImage loads them directly (unoptimized), so
    // /_next/image never becomes an open proxy for arbitrary URLs.
    remotePatterns: require("./lib/image-hosts.json"),
  },
  headers: async () => {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "same-origin" },
          { key: "Access-Control-Allow-Methods", value: "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
          {
            key: "Access-Control-Allow-Headers",
            value: "X-CSRF-Token, X-Forwarded-Host, X-API-Key, X-CSRF-Token, X-Forwarded-Host, X-API-Key, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Response-Time, X-SAME-DOMAIN, X-CSRF-Token",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
