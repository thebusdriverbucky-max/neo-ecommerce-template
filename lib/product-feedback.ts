import type { z } from "zod";

export function productFieldErrors(issues: z.core.$ZodIssue[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return fields;
}

export function productWriteError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "P2002") return {
    status: 409,
    body: { error: "A product with this slug already exists.", fieldErrors: { slug: "Choose a unique slug" } },
  };
  if (code === "P2025") return { status: 404, body: { error: "Product no longer exists. Refresh the product list." } };
  if (error instanceof SyntaxError) return { status: 400, body: { error: "Invalid JSON request." } };
  return { status: 500, body: { error: "Could not save the product. Please try again. If this continues, contact the store administrator." } };
}
