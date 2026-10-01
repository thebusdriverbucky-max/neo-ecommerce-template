export type CartSnapshotLine = { productId: string; quantity: number };

export function reconcilePurchasedCart<T extends CartSnapshotLine>(current: T[], purchased: CartSnapshotLine[]): T[] {
  const purchasedByProduct = new Map<string, number>();
  for (const line of purchased) {
    purchasedByProduct.set(line.productId, (purchasedByProduct.get(line.productId) || 0) + line.quantity);
  }
  return current.flatMap((line) => {
    const remaining = line.quantity - (purchasedByProduct.get(line.productId) || 0);
    return remaining > 0 ? [{ ...line, quantity: remaining }] : [];
  });
}

