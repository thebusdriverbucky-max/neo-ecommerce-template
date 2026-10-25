// File: app/profile/actions.ts

"use server";

import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { recalculateProductRating } from "@/lib/product-rating";

// Empty strings mean "not changed" (the profile form sends them for untouched fields).
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const profileSchema = z.object({
  name: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1, "Name must be between 1 and 50 characters").max(50, "Name must be between 1 and 50 characters").optional(),
  ),
  currentPassword: z.preprocess(emptyToUndefined, z.string().max(200).optional()),
  newPassword: z.preprocess(
    emptyToUndefined,
    z.string().min(8, "New password must be between 8 and 100 characters").max(100, "New password must be between 8 and 100 characters").optional(),
  ),
});

export async function updateProfile(data: {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const parsed = profileSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid profile data");
  }
  const { name, currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const updateData: { name?: string; password?: string; sessionVersion?: { increment: number } } = {};

  if (name) {
    updateData.name = name;
  }

  if (newPassword) {
    if (!currentPassword) {
      throw new Error("Current password is required to set a new password");
    }

    if (!user.password) {
      throw new Error("Cannot change password for OAuth users");
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new Error("Invalid current password");
    }

    updateData.password = await bcrypt.hash(newPassword, 10);
    // Revokes every session issued before the change, including this one.
    updateData.sessionVersion = { increment: 1 };
  }

  await db.user.update({
    where: { id: session.user.id },
    data: updateData,
  });

  revalidatePath("/profile");

  if (updateData.password) {
    // The current JWT now carries a stale sessionVersion, so end this session
    // cleanly and send the user to sign in with the new password.
    await signOut({ redirectTo: "/login?passwordChanged=1" });
  }

  return { success: true };
}

export type DeleteAccountResult = { success: false; error: string };

export async function deleteAccount(): Promise<DeleteAccountResult | undefined> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  const account = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });

  // Expected refusals are returned, not thrown: Next.js hides the message of a
  // thrown server action error in production builds.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (account && (account.role === "ADMIN" || (adminEmail && account.email.trim().toLowerCase() === adminEmail))) {
    return { success: false, error: "Administrator accounts cannot be deleted from the profile page." };
  }

  try {
    // Orders are financial records: they are kept (detached from the account)
    // so fulfilment and accounting stay intact, and unpaid PENDING orders keep
    // their reservation because the customer may still pay by bank transfer.
    // Everything else that belongs to the customer is removed in one atomic
    // step. Detaching is explicit because databases that have not run the
    // latest migration still cascade the foreign key.
    await db.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true },
        });
        if (!user) return;

        // Keep a contact address on orders that only referenced the account.
        await tx.order.updateMany({
          where: { userId, OR: [{ guestEmail: null }, { guestEmail: "" }] },
          data: { guestEmail: user.email, userId: null },
        });
        await tx.order.updateMany({
          where: { userId },
          data: { userId: null },
        });

        // Addresses used by an order must survive; the rest are deleted.
        await tx.address.updateMany({
          where: {
            userId,
            OR: [{ shippingOrders: { some: {} } }, { billingOrders: { some: {} } }],
          },
          data: { userId: null },
        });
        await tx.address.deleteMany({ where: { userId } });

        // Cart.userId has no foreign key, so it is not removed by the cascade.
        await tx.cart.deleteMany({ where: { userId } });
        await tx.wishlist.deleteMany({ where: { userId } });

        const reviews = await tx.review.findMany({
          where: { userId },
          select: { productId: true },
        });
        const productIds = Array.from(new Set(reviews.map((review) => review.productId)));
        await tx.review.deleteMany({ where: { userId } });

        // Accounts and sessions cascade with the user.
        await tx.user.delete({ where: { id: userId } });

        for (const productId of productIds) {
          await recalculateProductRating(tx, productId);
        }
      },
      { timeout: 20000 },
    );
  } catch {
    logger.error("Failed to delete user account");
    throw new Error("Failed to delete account");
  }

  await signOut({ redirectTo: "/" });
}
