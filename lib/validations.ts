// File: lib/validations.ts

import { z } from "zod";

// Do not coerce null/empty inputs to zero, or truncate fractional inventory.
const requiredNumber = (label: string) => z.union([
  z.number(),
  z.string().trim().min(1, `${label} is required`).transform(Number),
]).pipe(z.number({ error: `${label} must be a valid number` }).finite());

export const productImageSchema = z.string().trim().url("Enter a valid image URL")
  .refine(value => /^https?:\/\//i.test(value), "Image URL must use HTTP or HTTPS");

export const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  slug: z.string().trim().min(1, "Slug is required")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens"),
  description: z.string().trim().min(10, "Description must be at least 10 characters"),
  price: requiredNumber("Price").pipe(z.number().positive("Price must be positive")
    .max(99999999.99, "Price is too large")
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
      "Price must have at most 2 decimal places")),
  category: z.string().trim().min(1, "Category is required"),
  stock: requiredNumber("Stock").pipe(z.number().int("Stock must be a whole number")
    .nonnegative("Stock cannot be negative").max(2147483647, "Stock is too large")),
  image: productImageSchema,
  // Empty optional gallery rows are not images; malformed nonempty URLs still fail.
  images: z.array(z.string()).default([])
    .transform(values => values.map(value => value.trim()).filter(Boolean))
    .pipe(z.array(productImageSchema).max(4, "Use at most 4 additional images")),
  featured: z.boolean().default(false),
  isArchived: z.boolean().optional(),
});

export const addressSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string()
    .min(5, "Phone number is too short")
    .max(25, "Phone number is too long")
    .regex(/^[\+]?[\d\s\-\(\)]{5,25}$/, "Invalid phone number format"),
  street: z.string().min(1, "Street is required"),
  city: z.string()
    .min(1, "City name is required")
    .max(100, "City name is too long"),
  state: z.string().default(""),
  postalCode: z.string()
    .min(1, "Postal code is required")
    .max(15, "Postal code is too long"),
  country: z.string().min(1, "Country is required"),
  isDefault: z.boolean().default(false),
}).superRefine((data, ctx) => {
  const stateRequiredCountries = ['US', 'CA', 'AU', 'IN'];
  if (stateRequiredCountries.includes(data.country) && !data.state?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'State/Province is required', path: ['state'] });
  }
});

export const checkoutSchema = z.object({
  shippingAddressId: z.string(),
  billingAddressId: z.string(),
  promoCode: z.string().optional(),
});

export type ProductInput = z.infer<typeof productSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderItemSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.number().int().positive().min(1).max(100),
  // Legacy clients may still send a price; the server deliberately ignores it.
  price: z.number().finite().optional(),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(50),
  // Legacy clients may still send a total; the server deliberately ignores it.
  total: z.number().finite().optional(),
  shippingAddress: addressSchema.optional(),
  shippingAddressId: z.string().cuid().optional(),
  billingAddressId: z.string().cuid().optional(),
  discountCode: z.string().trim().min(1).max(50).optional(),
  guestEmail: z.string().email().optional(),
});
