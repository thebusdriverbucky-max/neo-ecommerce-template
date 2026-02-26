import { db } from "@/lib/db";

/**
 * Generates a unique order number in the format #YYYY-XXXXXX
 * where YYYY is the current year and XXXXXX is a sequential number.
 */
export async function generateOrderNumber(): Promise<string> {
  console.log("generateOrderNumber: starting...");
  const now = new Date();
  const year = now.getFullYear();

  // Find the last order created in the current year
  console.log("generateOrderNumber: fetching last order for year", year);
  const lastOrder = await db.order.findFirst({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
      },
      orderNumber: {
        not: null,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      orderNumber: true,
    },
  });

  console.log("generateOrderNumber: lastOrder found:", lastOrder?.orderNumber);

  let sequence = 1;

  if (lastOrder && lastOrder.orderNumber) {
    // Extract the sequence number from the last order number
    // Format: #YYYY-XXXXXX
    const parts = lastOrder.orderNumber.split("-");
    console.log("generateOrderNumber: parts:", parts);
    if (parts.length === 2) {
      const lastSequence = parseInt(parts[1], 10);
      console.log("generateOrderNumber: lastSequence:", lastSequence);
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }
  }

  console.log("generateOrderNumber: next sequence:", sequence);

  // Pad the sequence with leading zeros to ensure 6 digits
  const paddedSequence = sequence.toString().padStart(6, "0");

  return `#${year}-${paddedSequence}`;
}

