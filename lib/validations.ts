// File: lib/validations.ts

import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  price: z.coerce.number().positive("Price must be positive"),
  category: z.string().min(1, "Category is required"),
  stock: z.coerce.number().nonnegative("Stock cannot be negative"),
  image: z.string().url("Invalid image URL"),
  featured: z.boolean().default(false),
});

export const addressSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string()
    .min(7, "Phone number is too short")
    .max(20, "Phone number is too long")
    .regex(/^[\+]?[\d\s\-\(\)]{7,20}$/, "Invalid phone number format"),
  street: z.string().min(1, "Street is required"),
  city: z.string()
    .min(2, "City name must be at least 2 characters")
    .max(100, "City name is too long")
    .regex(/^[a-zA-ZÀ-ÿ\s\-'.]+$/, "City name can only contain letters, spaces, hyphens and apostrophes"),
  state: z.string().default(""),
  postalCode: z.string()
    .min(2, "Postal code is too short")
    .max(12, "Postal code is too long")
    .regex(/^[A-Z0-9][A-Z0-9\s\-]{0,10}[A-Z0-9]$|^[A-Z0-9]$/i,
      "Invalid postal code format"),
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
  price: z.number().positive(),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(50),
  total: z.number().positive().max(1000000), // Максимальная сумма заказа 1,000,000
  shippingAddress: addressSchema.optional(),
  guestEmail: z.string().email().optional(),
});
