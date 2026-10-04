# Discount codes

Create and edit codes in **Admin → Discounts**. The same validation is applied
in the browser and on both write endpoints; direct API calls cannot bypass it.

- Codes are trimmed and uppercased, contain no whitespace, and have 2–50 characters.
- Percentage discounts must be greater than zero and at most 100%.
- Fixed discounts are amounts in the store currency, not necessarily dollars.
- Values have at most two decimal places and cannot exceed 1,000,000.
- The applied discount never exceeds the merchandise subtotal. It does not
  discount tax or shipping; tax is calculated on the discounted merchandise.
- An empty expiry means no expiry. A selected date is valid through
  **23:59:59.999 UTC** on that day. API clients can also provide an ISO timestamp
  with an explicit timezone. All validation and checkout endpoints use the
  same stored instant and consider a code expired at that instant.
- Existing expiry timestamps are not migrated or guessed. Editing another
  field preserves the original timestamp; changing the date opts into end-of-day UTC.
- Duplicate codes return 409, invalid input 400, missing codes 404. The admin
  dialog stays open on failure and displays the error without losing input.
- Browser totals are estimates. Checkout re-reads prices and discount state;
  inactive, expired or incorrectly configured legacy codes cannot be used.

## Branch-specific checkout

The **main** branch uses currency-aware rounding, Stripe, and the discounted
merchandise subtotal for the free-shipping threshold.

The **lite** branch retains bank-transfer checkout and its existing
pre-discount free-shipping threshold. Its optional minimum subtotal, maximum
discount and usage limit are checked in both previews and checkout. Usage
claims remain atomic inside the order transaction. No Stripe dependency is
required by Lite.

No database migration is required by the discount validation changes.
