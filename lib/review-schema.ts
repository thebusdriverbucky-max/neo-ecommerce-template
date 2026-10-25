import { z } from "zod";

// Rating must stay within 1..5: the cached Product.rating column is
// Decimal(3,2), so a larger value would break every later rating update.
export const reviewSchema = z.object({
  rating: z
    .number({ error: "Rating must be a number from 1 to 5" })
    .int("Rating must be a whole number from 1 to 5")
    .min(1, "Rating must be at least 1")
    .max(5, "Rating must be at most 5"),
  title: z.string().trim().max(100, "Title must be 100 characters or fewer").nullish(),
  comment: z
    .string({ error: "Comment is required" })
    .trim()
    .min(1, "Comment is required")
    .max(2000, "Comment must be 2000 characters or fewer"),
});
