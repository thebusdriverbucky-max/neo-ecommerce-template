# Product admin and CMS contracts

## Products

- The product editor calls the authenticated JSON API; product creation is not a server action. Both create and update require ADMIN and use the same [validation schema](../lib/validations.ts:12).
- Required fields remain required. Price must fit the database precision (positive, at most two decimal places). Stock must be a nonnegative database-sized integer. Empty numbers and null are not zero; fractional stock is not truncated.
- Slugs use lowercase letters, numbers and single hyphens. Image URLs must use HTTP or HTTPS. Up to four nonempty additional image URLs are accepted; blank optional gallery rows are discarded. These are stricter write contracts, including when editing older products.
- The server uses the store currency on creation. An update preserves the existing currency rather than accepting a client override; store-wide currency changes remain in store settings. Archive restoration now persists the archive flag.
- Validation returns HTTP 400 with field errors, duplicate slug returns 409, missing update target returns 404, and unexpected persistence failures return a safe 500 message. The existing validation details remain available for JSON clients. Monetary values returned by Prisma through JSON remain decimal strings; tests cover that serialization.
- The dialog stays open on failure. Successful upload adds a URL to the draft, not to the database: Create/Update still needs to succeed. Storage failure cannot block either upload or saving.

## Cloudinary

The existing unsigned-upload model is retained. Configure both public cloud name and public upload preset variables documented in [the environment example](../.env.example:29). Use an image-only **unsigned preset with provider-side size/type restrictions**; browser checks are not an authorization boundary. No Cloudinary API secret belongs in client configuration.

The widget is not mounted if configuration is missing, cannot be opened before its script loads, and reports script timeout, provider failure and malformed success results. A successful response must be an image with a secure HTTPS URL. Script blockers and actual provider preset permissions still need browser verification. Changing public configuration requires a normal restart/redeployment by the operator.

## CMS source of truth

All supported routes are listed in [the shared defaults](../lib/cms-defaults.ts): About, Contact, FAQ, Terms, Privacy, Cookies, Careers, Press, Shipping, Support and Legal. Support and Legal previously had bootstrap records but no routes; both now have explicit routes.

- Title, content and visibility come from the matching CMS record via [the shared renderer](../components/shop/dynamic-page-content.tsx:7). HTML is sanitized, and text line breaks are retained.
- Hidden records return 404 rather than hardcoded replacement text and are excluded from [the sitemap](../app/sitemap.ts:12). Public CMS reads do not disclose hidden titles/content. Navigation links remain static and may lead to 404 for deliberately hidden pages.
- Missing records use the shared starter copy without writing during public requests. Database read failure raises a page error rather than pretending the CMS record is absent.
- Contact retains its interactive form; contact introduction, email, business hours and response-time copy should be maintained in its CMS content. The previous hardcoded public contact cards were removed. CMS text does **not** configure the email delivery recipient/provider, which remains deployment configuration.
- Home hero/CTA, store branding, social links and footer copyright remain separate store settings, not content-page records. Their existing public consumers read those settings. Empty branding values retain existing defaults.
- Arbitrary new page slugs and route renames are not supported. CMS actions validate fields and require ADMIN for listing/editing/creating/toggling/repair. Existing unsupported records are not deleted, but do not acquire public routes.

## Bootstrap and customer edits

[Baseline provisioning](../scripts/db-bootstrap.ts:6), already part of the existing deployment build lifecycle, and the optional admin “Add Missing Default Pages” repair action share create-only upserts. All supported records are provisioned automatically. Existing title, content, visibility and settings are not overwritten. No buyer needs to click a seed button.

The separate destructive demo reset remains opt-in and is not part of normal provisioning. No migration or data repair is performed by these code changes. An older installation receives missing stored records at its next normal provision/deployment; public starter fallback works before then. Previously overwritten customer text cannot be recovered without a backup.

## Safe verification

- [API/schema/upload regression tests](../tests/product-admin.test.ts) execute actual API modules with fake auth/database boundaries.
- [UI regression tests](../tests/product-ui.test.ts) mount actual components in jsdom with mocked Cloudinary and fetch, covering loading, retained callbacks, malformed results, storage failure, field/general errors, double submission and success.
- [CMS regression tests](../tests/cms.test.ts) exercise all actual public route modules, sanitization, visibility, actions, create-only provisioning and sitemap. The bootstrap entrypoint itself is not executed.
- Existing checkout totals, payment binding and webhook signature tests stay isolated from live providers.

Manual checks still required in an explicitly authorized test environment: actual Cloudinary script/preset upload, create/reload/edit/restore with a disposable database, CMS edits and hidden routes after navigation, and the contact email flow. Legal, shipping and FAQ starter copy must be reviewed by the store owner before launch. Never use a production build as a harmless smoke test: this repository's build also migrates/provisions the database.
