import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CMS_DEFAULT_PAGES, CMS_SLUGS, ensureCMSPages } from "../lib/cms-defaults";
import { moduleLoader } from "./helpers/load-module";

test("baseline and admin repair share idempotent create-only CMS defaults", async () => {
  const edited = { slug: "cookies", title: "Customer title", content: "Customer text", isVisible: false };
  const pages = new Map<string, any>([["cookies", { ...edited }]]);
  const upserts: any[] = [];
  const db: any = { contentPage: { upsert: async (args: any) => {
    upserts.push(args);
    const existing = pages.get(args.where.slug);
    pages.set(args.where.slug, existing ? { ...existing, ...args.update } : args.create);
  } } };
  await ensureCMSPages(db);
  await ensureCMSPages(db);
  assert.equal(pages.size, CMS_DEFAULT_PAGES.length);
  assert.deepEqual(pages.get("cookies"), edited);
  assert.ok(upserts.every(args => Object.keys(args.update).length === 0));
  const bootstrap = readFileSync(new URL("../scripts/db-bootstrap.ts", import.meta.url), "utf8");
  assert.match(bootstrap, /await ensureCMSPages\(prisma\)/);
  assert.doesNotMatch(bootstrap, /contentPage\.(?:delete|update)/);
});

test("actual CMS actions authorize writes/repair, preserve edits, validate fields and redact hidden content", async () => {
  let role = "CUSTOMER";
  let writes = 0;
  const record = { id: "page-1", slug: "cookies", title: "Private title", content: "Private draft", isVisible: false };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role } }) },
    "@/lib/db": { db: { contentPage: {
      findUnique: async () => record,
      findMany: async () => [record],
      update: async ({ data }: any) => { writes++; Object.assign(record, data); },
      create: async () => { writes++; },
      upsert: async ({ update }: any) => { writes++; assert.deepEqual(update, {}); },
    } } },
    "next/cache": { revalidatePath() {} },
  });
  const cms = load("app/actions/cms.ts");
  assert.equal((await cms.seedCMSPages()).success, false);
  assert.equal((await cms.getPages()).success, false);
  assert.equal((await cms.updatePage(record.id, { title: "Attack" })).success, false);
  assert.equal((await cms.createPage(record)).success, false);
  assert.equal((await cms.togglePageVisibility(record.id, true)).success, false);
  assert.equal(writes, 0);
  const hidden = await cms.getPageBySlug("cookies");
  assert.equal(hidden.data.isVisible, false);
  assert.equal(hidden.data.content, "");
  role = "ADMIN";
  assert.equal((await cms.seedCMSPages()).success, true);
  assert.equal(record.content, "Private draft");
  assert.equal((await cms.updatePage(record.id, { slug: "terms" })).success, false);
  assert.equal((await cms.updatePage(record.id, { title: " " })).success, false);
  assert.equal((await cms.createPage({ ...record, slug: "no-route" })).success, false);
  assert.equal((await cms.togglePageVisibility(record.id, "false")).success, false);
  assert.equal((await cms.updatePage(record.id, { title: "Customer title", content: "", isVisible: true })).success, true);
  assert.equal((await cms.getPageBySlug("cookies")).data.title, "Customer title");
});

test("every supported actual route uses CMS title/content/visibility and sanitizes HTML", async () => {
  let response: any;
  const readSlugs: string[] = [];
  const load = moduleLoader({
    "@/app/actions/cms": { getPageBySlug: async (slug: string) => { readSlugs.push(slug); return response; } },
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
  });
  for (const slug of CMS_SLUGS) {
    const route = load(`app/${slug}/page.tsx`);
    assert.equal(route.dynamic, "force-dynamic");
    const element = route.default();
    const render = async () => renderToStaticMarkup(await element.type(element.props));
    response = { success: true, data: { slug, title: `Edited ${slug}`, content: '<h2>Edited body</h2>\nSecond line<script>alert(1)</script><img src="x" onerror="alert(1)">', isVisible: true } };
    const html = await render();
    assert.match(html, new RegExp(`Edited ${slug}`));
    assert.match(html, /<h2>Edited body<\/h2>/);
    assert.match(html, /whitespace-pre-wrap/);
    assert.doesNotMatch(html, /<script|onerror/);
    if (slug === "contact") {
      assert.match(html, /<form/);
      assert.doesNotMatch(html, /support@store.com|9 AM/);
    }
    response.data.isVisible = false;
    await assert.rejects(render, /NOT_FOUND/);
    response = { success: true, data: null };
    assert.match(await render(), new RegExp(CMS_DEFAULT_PAGES.find(page => page.slug === slug)!.title));
    response = { success: false };
    await assert.rejects(render, /temporarily unavailable/);
    assert.equal(readSlugs[readSlugs.length - 1], slug);
  }
});

test("sitemap excludes hidden CMS routes and includes supported defaults", async () => {
  const load = moduleLoader({ "@/lib/db": { db: {
    contentPage: { findMany: async () => [{ slug: "cookies", isVisible: false }] },
    product: { findMany: async () => [] },
  } } });
  const links = await load("app/sitemap.ts").default();
  assert.ok(!links.some((page: any) => page.url.endsWith("/cookies")));
  assert.ok(links.some((page: any) => page.url.endsWith("/press")));
  assert.ok(links.some((page: any) => page.url.endsWith("/support")));
});
