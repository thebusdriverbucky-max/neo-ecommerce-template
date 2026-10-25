// Server-side validation for the admin settings form (used by
// app/actions/settings.ts). Pure and client-safe: the settings page imports the
// option lists from here.
import { z } from "zod";
import { COUNTRIES } from "@/lib/constants";

/** Currencies offered in the admin form. */
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

/** Languages offered for the <html lang> attribute. */
export const SITE_LANGUAGES = [
  { code: "en", label: "English (en)" },
  { code: "ru", label: "Russian (ru)" },
  { code: "uk", label: "Ukrainian (uk)" },
  { code: "de", label: "German (de)" },
  { code: "fr", label: "French (fr)" },
  { code: "es", label: "Spanish (es)" },
] as const;

// The order engine (lib/order-money.ts) rejects any amount or order total
// above 1,000,000.00, so a stored value beyond it would turn every checkout
// into an error. Shipping is capped lower so it can never consume the whole
// order budget on its own.
export const MAX_ORDER_AMOUNT = 1_000_000;
export const MAX_SHIPPING_COST = 100_000;

const COUNTRY_NAMES = new Set<string>(COUNTRIES.map((country) => country.name));
const LANGUAGE_CODES = SITE_LANGUAGES.map((language) => language.code) as [string, ...string[]];

const decimalPlaces = (max: number) => (value: number) =>
  Math.abs(value * 10 ** max - Math.round(value * 10 ** max)) < 1e-6;

const numberInRange = (label: string, min: number, max: number, places: number) =>
  z
    .number({ error: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max.toLocaleString("en-US")}`)
    .refine(decimalPlaces(places), `${label} can have at most ${places} decimal places`);

// Empty text is stored as null so the storefront falls back to its defaults.
const optionalText = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const optionalUrl = (label: string) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .max(2048, `${label} is too long`)
    .refine((value) => {
      if (value === "") return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }, `${label} must be a valid http(s) URL`)
    .transform((value) => (value === "" ? null : value))
    .nullish();

function currencyField(legacyCurrency?: string | null) {
  const legacy = legacyCurrency?.trim().toUpperCase() || null;
  return z.string({ error: "Currency is required" }).transform((value, ctx) => {
    const normalized = value.trim().toUpperCase();
    const supported = (SUPPORTED_CURRENCIES as readonly string[]).includes(normalized);
    // A store already running on another 3-letter currency can keep saving
    // other settings; only switching to an unlisted currency is refused.
    if (supported || (legacy !== null && normalized === legacy && /^[A-Z]{3}$/.test(normalized))) {
      return normalized;
    }
    ctx.addIssue({ code: "custom", message: "Unsupported currency" });
    return z.NEVER;
  });
}

function buildSettingsSchema(legacyCurrency?: string | null) {
  return z.object({
    storeName: optionalText("Store name", 100),
    storeEmail: z
      .string({ error: "Support email must be text" })
      .trim()
      .max(254, "Support email is too long")
      .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email address")
      .transform((value) => (value === "" ? null : value))
      .nullish(),
    currency: currencyField(legacyCurrency),
    taxRate: numberInRange("Tax rate", 0, 100, 4),
    shippingCost: numberInRange("Shipping cost", 0, MAX_SHIPPING_COST, 2),
    // null disables free shipping, 0 makes every order ship free. Omitted keeps the stored value.
    freeShippingThreshold: numberInRange("Free shipping threshold", 0, MAX_ORDER_AMOUNT, 2).nullable().optional(),
    enabledCountries: z
      .array(
        z.string().refine((name) => COUNTRY_NAMES.has(name), "Unknown country"),
        { error: "Enabled countries must be a list" },
      )
      .max(COUNTRIES.length, "Too many countries")
      .transform((names) => [...new Set(names)])
      .optional(),
    enabledCategories: z
      .array(
        z.string().trim().min(1, "Category names cannot be empty").max(50, "Category names must be 50 characters or fewer"),
        { error: "Categories must be a list" },
      )
      .max(50, "At most 50 categories are allowed")
      .transform((names) => [...new Set(names)])
      .optional(),
    tiktokUrl: optionalUrl("TikTok URL"),
    facebookUrl: optionalUrl("Facebook URL"),
    instagramUrl: optionalUrl("Instagram URL"),
    heroTitle: optionalText("Hero headline", 150),
    heroSubtitle: optionalText("Hero subheadline", 300),
    heroButtonText: optionalText("Hero button text", 50),
    ctaTitle: optionalText("CTA title", 150),
    ctaSubtitle: optionalText("CTA subtitle", 300),
    ctaButtonText: optionalText("CTA button text", 50),
    footerCopyright: optionalText("Copyright text", 200),
    faviconUrl: optionalUrl("Favicon URL"),
    ogImageUrl: optionalUrl("OG image URL"),
    siteLang: z.enum(LANGUAGE_CODES, { error: "Choose one of the listed languages" }).optional(),
    paymentIban: optionalText("IBAN", 64),
    paymentBankName: optionalText("Bank name", 100),
    paymentAccountName: optionalText("Account holder", 100),
    paymentDetails: optionalText("Payment instructions", 2000),
  });
}

export const settingsSchema = buildSettingsSchema();

/** Schema that also accepts the store's already-saved currency, whatever it is. */
export function settingsSchemaFor(currentCurrency?: string | null) {
  return buildSettingsSchema(currentCurrency);
}

export type ValidatedSettings = z.infer<typeof settingsSchema>;

export function settingsFieldErrors(issues: z.core.$ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  return fields;
}
