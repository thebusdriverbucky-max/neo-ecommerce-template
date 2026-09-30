import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { productSchema } from "../lib/validations";
import { cloudinaryImageUrl, saveProductDraft } from "../lib/product-upload";
import { moduleLoader } from "./helpers/load-module";

const valid = {
  name: "Test product", slug: "test-product", description: "A useful test product",
  price: "12.50", category: "Clothing", stock: "0", image: "https://res.cloudinary.com/test/image/upload/main.png",
  images: ["", "  ", " https://example.com/extra.png "], featured: false,
};

test("product validation handles empty optional gallery and rejects lossy numeric coercion", () => {
  const data = productSchema.parse(valid);
  assert.equal(data.price, 12.5);
  assert.equal(data.stock, 0);
  assert.deepEqual(data.images, ["https://example.com/extra.png"]);
  for (const stock of ["", " ", null, false, "1.5", "2items", -1, 2147483648]) {
    assert.equal(productSchema.safeParse({ ...valid, stock }).success, false, `stock ${stock}`);
  }
  for (const price of ["", null, false, "NaN", Infinity, "1.001", "100000000"]) {
    assert.equal(productSchema.safeParse({ ...valid, price }).success, false, `price ${price}`);
  }
  for (const changes of [{ image: "" }, { image: "javascript:alert(1)" }, { images: ["broken"] },
    { images: Array(5).fill(valid.image) }, { description: "short" }, { name: " " }, { slug: "bad/route" }]) {
    assert.equal(productSchema.safeParse({ ...valid, ...changes }).success, false);
  }
});

test("Cloudinary current response shape and storage failures", () => {
  const url = valid.image;
  assert.equal(cloudinaryImageUrl({ event: "success", info: { secure_url: url, resource_type: "image" } }), url);
  for (const result of [null, {}, { event: "success", info: "pending" }, { event: "queues-end", info: { secure_url: url } },
    { event: "success", info: { secure_url: url, resource_type: "video" } },
    { event: "success", info: { url } }, { event: "success", info: { secure_url: "http://example.com/a.png" } }]) {
    assert.equal(cloudinaryImageUrl(result), null);
  }
  assert.doesNotThrow(() => saveProductDraft({ setItem() { throw new Error("Quota exceeded"); } }, valid));
});

test("actual product POST/PUT enforce admin, validate, serialize Decimal and explain DB failures", async () => {
  let role = "CUSTOMER";
  let writes = 0;
  let written: any;
  let failure: unknown;
  const paths: string[] = [];
  const write = async ({ data }: any) => {
    writes++;
    if (failure) throw failure;
    written = data;
    return { id: "product-1", ...data, price: new Prisma.Decimal(data.price) };
  };
  const load = moduleLoader({
    "@/lib/auth": { auth: async () => ({ user: { role } }) },
    "@/lib/db": { db: { product: { create: write, update: write }, storeSettings: { findFirst: async () => ({ currency: "EUR" }) } } },
    "next/cache": { revalidatePath: (value: string) => paths.push(value) },
  });
  const { POST } = load("app/api/products/route.ts");
  const { PUT } = load("app/api/products/[id]/route.ts");
  const request = (body: unknown) => new Request("http://localhost/api/products", { method: "POST", body: JSON.stringify(body) });
  for (const handler of [POST, (req: Request) => PUT(req, { params: { id: "product-1" } })]) {
    assert.equal((await handler(request(valid))).status, 401);
  }
  assert.equal(writes, 0);
  role = "ADMIN";
  for (const handler of [POST, (req: Request) => PUT(req, { params: { id: "product-1" } })]) {
    const bad = await handler(request({ ...valid, stock: "1.5", image: "" }));
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).fieldErrors.stock);
  }
  assert.equal(writes, 0);
  const created = await POST(request({ ...valid, currency: "ATTACKER" }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).price, "12.5");
  assert.equal(written.currency, "EUR");
  assert.deepEqual(written.images, ["https://example.com/extra.png"]);
  assert.equal(written.stock, 0);
  assert.ok(paths.includes("/products"));
  const restored = await PUT(request({ ...valid, isArchived: false, currency: "ATTACKER" }), { params: { id: "product-1" } });
  assert.equal(restored.status, 200);
  assert.equal(written.isArchived, false);
  assert.equal(written.currency, undefined);
  for (const handler of [POST, (req: Request) => PUT(req, { params: { id: "product-1" } })]) {
    failure = { code: "P2002", message: "sensitive database details" };
    const duplicate = await handler(request(valid));
    assert.equal(duplicate.status, 409);
    assert.ok((await duplicate.json()).fieldErrors.slug);
    failure = new Error("sensitive database details");
    const unavailable = await handler(request(valid));
    assert.equal(unavailable.status, 500);
    assert.doesNotMatch(await unavailable.text(), /sensitive/);
    failure = undefined;
    const malformed = new Request("http://localhost/api/products", { method: "POST", body: "{" });
    assert.equal((await handler(malformed)).status, 400);
  }
});
