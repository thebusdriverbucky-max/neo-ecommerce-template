import { z } from "zod";

export function discountFieldErrors(issues: z.core.$ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  return errors;
}

export function discountApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return { status: 400, body: { error: "Please correct the highlighted fields.", fieldErrors: discountFieldErrors(error.issues) } };
  }
  if (error instanceof SyntaxError) return { status: 400, body: { error: "Invalid JSON" } };
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "P2002") {
    return { status: 409, body: { error: "A discount with this code already exists.", fieldErrors: { code: "Choose a different code" } } };
  }
  if (code === "P2025") return { status: 404, body: { error: "Discount code was not found" } };
  console.error("Discount API error:", error);
  return { status: 500, body: { error: "Unable to process the discount. Please try again." } };
}
