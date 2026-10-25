import type { Prisma } from "@prisma/client";

type RatingClient = Pick<Prisma.TransactionClient, "review" | "product">;

/**
 * Recomputes a product's cached average rating from its reviews. Call it in
 * the same transaction that creates or deletes reviews.
 */
export async function recalculateProductRating(client: RatingClient, productId: string): Promise<number> {
  const { _avg } = await client.review.aggregate({
    where: { productId },
    _avg: { rating: true },
  });
  const average = _avg.rating ?? 0;
  const rating = Math.min(5, Math.max(0, Math.round(average * 100) / 100));
  await client.product.updateMany({ where: { id: productId }, data: { rating } });
  return rating;
}
