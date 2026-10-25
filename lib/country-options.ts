// Pure country-picker rules shared by CountrySelect and the checkout form.
// Client-safe: no server-only imports.
import { COUNTRIES } from "@/lib/constants";
import { isCountryEnabled, toCountryCode } from "@/lib/shipping";

export type CountryOption = { code: string; name: string };

/**
 * Countries a customer may ship to. Settings store country names (older data
 * may hold ISO codes); an empty list allows every country.
 */
export function availableCountries(enabledCountries: string[] | null | undefined): CountryOption[] {
  return COUNTRIES.filter((country) => isCountryEnabled(country.code, enabledCountries));
}

export function filterCountries(countries: CountryOption[], searchTerm: string): CountryOption[] {
  const term = searchTerm.trim().toLowerCase();
  return term ? countries.filter((country) => country.name.toLowerCase().includes(term)) : countries;
}

/**
 * Maps free text typed into the country box to an ISO code. Only an exact
 * (case-insensitive) name of an enabled country resolves; partial text yields
 * "" so the form never submits a country the customer did not actually pick.
 */
export function resolveCountryInput(text: string, enabledCountries: string[] | null | undefined): string {
  const typed = text.trim().toLowerCase();
  if (!typed) return "";
  return availableCountries(enabledCountries).find((country) => country.name.toLowerCase() === typed)?.code ?? "";
}

/**
 * Normalizes a stored/restored country value to an ISO code. Returns "" when
 * the value is unknown or its country is no longer enabled.
 */
export function sanitizeCountryValue(value: string | null | undefined, enabledCountries: string[] | null | undefined): string {
  const code = toCountryCode(value);
  return code && isCountryEnabled(code, enabledCountries) ? code : "";
}
