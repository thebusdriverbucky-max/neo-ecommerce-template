"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const getMyOrders = async () => {
  const session = await auth();

  if (!session?.user?.id) {
    return [];
  }

  const orders = await db.order.findMany({
    where: {
      userId: session.user.id,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return orders;
};
