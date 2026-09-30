import { productImageSchema } from "./validations";

export function cloudinaryImageUrl(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("event" in result) || result.event !== "success"
    || !("info" in result) || !result.info || typeof result.info !== "object") return null;
  const info = result.info;
  if ("resource_type" in info && info.resource_type !== "image") return null;
  if (!("secure_url" in info)) return null;
  const parsed = productImageSchema.safeParse(info.secure_url);
  return parsed.success && parsed.data.startsWith("https://") ? parsed.data : null;
}

// Storage is a convenience, never a prerequisite for upload or saving a product.
export function saveProductDraft(storage: Pick<Storage, "setItem">, value: unknown) {
  try { storage.setItem("admin_product_form_draft", JSON.stringify(value)); } catch { /* unavailable/quota */ }
}
