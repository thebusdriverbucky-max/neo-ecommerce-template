// File: next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // JSDOM reads assets relative to its installed files. Externalize the
    // whole sanitizer so nested JSDOM versions are not bundled into .next.
    serverComponentsExternalPackages: ["isomorphic-dompurify"],
  },
  images: {
    // Hosts served through the built-in image optimizer (also read by
    // lib/image-hosts.ts). Images from any other HTTPS host still work:
    // StoreImage loads them directly (unoptimized), so /_next/image never
    // becomes an open proxy for arbitrary URLs. To optimize another host,
    // add it to lib/image-hosts.json and restart the server.
    remotePatterns: require("./lib/image-hosts.json"),
  },
  headers: async () => {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
