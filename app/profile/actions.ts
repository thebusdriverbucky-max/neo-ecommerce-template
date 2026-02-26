// File: app/profile/actions.ts

"use server";

import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

export async function updateProfile(data: {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const updateData: any = {};

  if (data.name) {
    updateData.name = data.name;
  }

  if (data.newPassword) {
    if (!data.currentPassword) {
      throw new Error("Current password is required to set a new password");
    }

    if (!user.password) {
      throw new Error("Cannot change password for OAuth users");
    }

    const isValid = await bcrypt.compare(data.currentPassword, user.password);
    if (!isValid) {
      throw new Error("Invalid current password");
    }

    const hashedPassword = await bcrypt.hash(data.newPassword, 10);
    updateData.password = hashedPassword;
  }

  await db.user.update({
    where: { id: session.user.id },
    data: updateData,
  });

  revalidatePath("/profile");
  return { success: true };
}

export async function deleteAccount() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  try {
    await db.user.delete({
      where: { id: session.user.id },
    });
  } catch (error) {
    console.error("Failed to delete user:", error);
    throw new Error("Failed to delete account");
  }

  await signOut({ redirectTo: "/" });
}
