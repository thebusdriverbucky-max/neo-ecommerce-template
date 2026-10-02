export const DEFAULT_PAYMENT_FALLBACK_MESSAGE =
  "Thank you for your order. We will send you the payment instructions shortly. Your items are reserved for 7 days.";

export function paymentFallbackMessage(paymentDetails?: string | null): string {
  return paymentDetails?.trim() || DEFAULT_PAYMENT_FALLBACK_MESSAGE;
}
