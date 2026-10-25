import assert from "node:assert/strict";
import test from "node:test";

test("robots.txt points to this store's sitemap and never to the template demo domain", async () => {
  const keys = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_STORE_URL", "NEXT_PUBLIC_SITE_URL"] as const;
  const saved = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    const robots = (await import("../app/robots")).default;

    process.env.NEXT_PUBLIC_APP_URL = "https://shop.example.test/";
    const configured = robots();
    assert.equal(configured.sitemap, "https://shop.example.test/sitemap.xml");
    assert.ok(!JSON.stringify(configured).includes("neo-e-commerce.vercel.app"));
    const rules = Array.isArray(configured.rules) ? configured.rules[0] : configured.rules;
    assert.ok(!([] as string[]).concat(rules.disallow ?? []).includes("/_next"), "page assets must stay crawlable");

    delete process.env.NEXT_PUBLIC_APP_URL;
    const unconfigured = robots();
    assert.equal("sitemap" in unconfigured, false);
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
});
