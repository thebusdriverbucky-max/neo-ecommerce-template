const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes a value for HTML text and quoted attribute contexts. Every value
 * that did not originate in this codebase (customer input, admin-edited
 * content, product data) must pass through this before it is interpolated
 * into an email or other HTML string.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** Single-line text for email subjects and other header-like fields. */
export function headerText(value: unknown, maxLength = 200): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}
