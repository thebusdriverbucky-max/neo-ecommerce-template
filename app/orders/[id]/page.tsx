import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/Button";
import { CheckCircle2, Package, Truck, CreditCard, MapPin, AlertCircle } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { stripe } from "@/lib/stripe";
import { confirmOrder } from "@/app/api/stripe/webhooks/route";

interface OrderDetailsPageProps {
  params: {
    id: string;
  };
  searchParams: {
    success?: string;
  };
}

export default async function OrderDetailsPage({ params, searchParams }: OrderDetailsPageProps) {
  const session = await auth();
  const isSuccess = searchParams.success === "true";

  let order = await db.order.findUnique({
    where: { id: params.id },
    include: {
      items: {
        include: {
          product: true,
        },
      },
      shippingAddress: true,
    },
  });

  if (!order) {
    notFound();
  }

  // Fallback logic: if we are on success page but order is still PENDING, check Stripe
  if (isSuccess && order.status === "PENDING") {
    try {
      // We need to find the Stripe session or payment intent
      // In our system, we store it in stripePaymentIntentId
      const stripeId = (order as any).stripePaymentIntentId;

      if (stripeId) {
        let isPaid = false;
        let paymentIntentId = stripeId;

        if (stripeId.startsWith('cs_')) {
          // It's a checkout session
          const stripeSession = await stripe.checkout.sessions.retrieve(stripeId);
          if (stripeSession.payment_status === 'paid') {
            isPaid = true;
            paymentIntentId = stripeSession.payment_intent as string || stripeId;
          }
        } else if (stripeId.startsWith('pi_')) {
          // It's a payment intent
          const paymentIntent = await stripe.paymentIntents.retrieve(stripeId);
          if (paymentIntent.status === 'succeeded') {
            isPaid = true;
          }
        }

        if (isPaid) {
          const settings = await db.storeSettings.findFirst();
          await confirmOrder(order.id, paymentIntentId, settings);

          // Refresh order data after confirmation
          const updatedOrder = await db.order.findUnique({
            where: { id: params.id },
            include: {
              items: {
                include: {
                  product: true,
                },
              },
              shippingAddress: true,
            },
          });
          if (updatedOrder) {
            order = updatedOrder;
          }
        }
      }
    } catch (error) {
      console.error(`[FALLBACK] Error during manual order confirmation:`, error);
    }
  }

  // Проверка прав доступа: владелец, админ или гостевой заказ
  const isAdmin = session?.user?.role === "ADMIN";
  const isOwner = session?.user?.id && order.userId === session.user.id;
  const isGuestOrder = !order.userId && (order as any).guestEmail;

  if (!isAdmin && !isOwner && !isGuestOrder) {
    redirect("/login");
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {isSuccess && (
        <div className="flex flex-col items-center justify-center mb-12 text-center bg-green-50 dark:bg-green-900/20 p-8 rounded-2xl border border-green-100 dark:border-green-900/30">
          <div className="mb-4 text-green-600 dark:text-green-500">
            <CheckCircle2 size={64} strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white mb-2">
            Thank you for your order!
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
            Your order <span className="font-semibold text-gray-900 dark:text-white">{order.orderNumber || `#${order.id}`}</span> has been placed successfully.
          </p>
          <div className="flex gap-4">
            <Button asChild variant="outline">
              <Link href="/products">Continue Shopping</Link>
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Order Details</h2>
          <p className="text-gray-500 dark:text-gray-400">
            Placed on {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${order.status === 'DELIVERED' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
            order.status === 'CANCELLED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
              'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            }`}>
            {order.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          {/* Order Items */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
              <Package className="w-5 h-5 text-gray-400" />
              <h3 className="font-semibold">Items</h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {order.items.map((item) => (
                <div key={item.id} className="p-4 flex gap-4">
                  <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex-shrink-0">
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 dark:text-white truncate">
                      {item.product.name}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Qty: {item.quantity}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {formatPrice(Number(item.price) * item.quantity, (order as any).currency)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatPrice(Number(item.price), (order as any).currency)} each
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-gray-400" />
              <h3 className="font-semibold">Summary</h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
                <span>{formatPrice(Number(order.subtotal), (order as any).currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Shipping</span>
                <span>{formatPrice(Number(order.shippingCost), (order as any).currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Tax</span>
                <span>{formatPrice(Number(order.tax), (order as any).currency)}</span>
              </div>
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{formatPrice(Number(order.total), (order as any).currency)}</span>
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-gray-400" />
              <h3 className="font-semibold">Shipping Address</h3>
            </div>
            <div className="p-4 text-sm text-gray-600 dark:text-gray-400 space-y-1">
              {order.shippingAddress ? (
                <>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {order.shippingAddress.firstName} {order.shippingAddress.lastName}
                  </p>
                  <p>{order.shippingAddress.street}</p>
                  <p>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}</p>
                  <p>{order.shippingAddress.country}</p>
                  <p className="pt-2">{order.shippingAddress.phone}</p>
                </>
              ) : (
                <p>No shipping address provided</p>
              )}
            </div>
          </div>

          {/* Tracking */}
          {order.trackingNumber && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
                <Truck className="w-5 h-5 text-gray-400" />
                <h3 className="font-semibold">Tracking</h3>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Tracking Number</p>
                <p className="font-mono font-medium">{order.trackingNumber}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
