// app/profile/page.tsx

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProfileActions } from "./profile-actions";
import { db } from "@/lib/db";
import { ProfileForm } from "@/components/profile/profile-form";
import { getMyOrders } from "@/app/actions/orders";
import OrderHistory from "@/components/profile/order-history";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) {
    redirect("/login");
  }

  const orders = await getMyOrders();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-center">My Profile</h1>

      <ProfileForm user={user} />

      <div className="max-w-4xl mx-auto mt-8">
        <OrderHistory orders={orders} />
      </div>
      <div className="max-w-2xl mx-auto mt-8 flex justify-end">
        <ProfileActions />
      </div>
    </div>
  );
}

