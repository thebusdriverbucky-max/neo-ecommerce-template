import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("server sanitizer stays external even when test JSDOM uses a different version", () => {
  const config = require("../next.config.js");
  assert.ok(config.experimental?.serverComponentsExternalPackages?.includes("isomorphic-dompurify"),
    "Bundling nested JSDOM relocates its default-stylesheet.css lookup into .next");
  // Resolve through the sanitizer, not through the development/test JSDOM.
  const sanitizerRequire = createRequire(require.resolve("isomorphic-dompurify"));
  assert.doesNotThrow(() => sanitizerRequire("jsdom"));
  const DOMPurify = require("isomorphic-dompurify");
  const html = DOMPurify.sanitize('<h2>Safe</h2><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">link</a>');
  assert.match(html, /<h2>Safe<\/h2>/);
  assert.doesNotMatch(html, /<script|onerror|javascript:/);
});
