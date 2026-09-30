"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCart, type CheckoutCartItem } from "@/lib/cart-store";

export function CheckoutCartSync({ orderId, status, items }: {
  orderId: string;
  status: string;
  items: CheckoutCartItem[];
}) {
  const router = useRouter();
  const refreshAttempts = useRef(0);

  useEffect(() => { refreshAttempts.current = 0; }, [orderId]);

  useEffect(() => {
    // These props come from the authorized server-rendered order, not query
    // parameters. Pending/failed/cancelled orders never remove cart contents.
    if (["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status)) {
      const complete = () => useCart.getState().completeCheckout(orderId, items);
      if (useCart.persist.hasHydrated()) complete();
      return useCart.persist.onFinishHydration(complete);
    }
    if (status !== "PENDING") return;

    // Webhooks can arrive after the browser return. Refresh the authorized
    // server view for up to a minute, without a public order-status endpoint.
    if (refreshAttempts.current >= 20) return;
    const timer = window.setInterval(() => {
      refreshAttempts.current++;
      router.refresh();
      if (refreshAttempts.current >= 20) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [orderId, status, items, router]);

  return null;
}
