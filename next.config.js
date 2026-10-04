// File: next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // JSDOM reads assets relative to its installed files. Externalize the
    // whole sanitizer so nested JSDOM versions are not bundled into .next.
    serverComponentsExternalPackages: ["isomorphic-dompurify"],
  },
  images: {
    domains: ["res.cloudinary.com", "localhost", "i.imgur.com"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "http",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "source.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "i.imgur.com",
      },
    ],
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
