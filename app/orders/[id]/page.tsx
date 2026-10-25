import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/Button";
import { StoreImage } from "@/components/ui/StoreImage";
import { CheckCircle2, Package, Truck, CreditCard, MapPin, AlertCircle } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { verifyGuestOrderToken } from "@/lib/guest-order-token";
import { paymentFallbackMessage } from "@/lib/payment-instructions";
import { orderStatusLabel } from "@/lib/admin-orders";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  REFUNDED: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function formatDate(value: Date) {
  return value.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

interface OrderDetailsPageProps {
  params: {
    id: string;
  };
  searchParams: {
    success?: string;
    token?: string;
  };
}

export default async function OrderDetailsPage({ params, searchParams }: OrderDetailsPageProps) {
  const session = await auth();
  const isSuccess = searchParams.success === "true";

  const order = await db.order.findUnique({
    where: { id: params.id },
    include: {
      items: {
        include: {
          product: { select: { name: true, image: true } },
        },
      },
      shippingAddress: true,
    },
  });

  // Lite only shows bank-transfer orders (they always have a reservation).
  if (!order?.reservationExpiresAt) {
    notFound();
  }

  const isAdmin = session?.user?.role === "ADMIN";
  const isOwner = session?.user?.id && order.userId === session.user.id;
  const isGuestOrder = !order.userId && verifyGuestOrderToken(searchParams.token, order.id);

  if (!isAdmin && !isOwner && !isGuestOrder) {
    redirect("/login");
  }

  const reference = order.orderNumber || order.id;
  const total = formatPrice(Number(order.total), order.currency);
  const discount = Number(order.discountAmount ?? 0);
  const overdue = order.status === "PENDING" && order.reservationExpiresAt.getTime() <= Date.now();
  const bankRows = [
    ["IBAN", order.paymentIban],
    ["Bank", order.paymentBankName],
    ["Account name", order.paymentAccountName],
  ].filter((row): row is [string, string] => Boolean(row[1]));

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
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[order.status] ?? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}>
            {orderStatusLabel(order.status)}
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
                  <div className="relative w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden flex-shrink-0">
                    <StoreImage
                      src={item.product.image}
                      alt={item.product.name}
                      fill
                      sizes="80px"
                      className="object-cover"
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
                      {formatPrice(Number(item.price) * item.quantity, order.currency)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatPrice(Number(item.price), order.currency)} each
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {order.status === "PENDING" && order.paymentIban && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4 text-sm space-y-2">
              <h3 className="font-semibold">Bank transfer instructions</h3>
              {bankRows.map(([label, value]) => (
                <p key={label} className="break-all"><span className="font-medium">{label}:</span> {value}</p>
              ))}
              {order.paymentDetails && <p className="whitespace-pre-line">{order.paymentDetails}</p>}
              <p className="font-medium">Transfer exactly {total} and use <span className="font-mono">{reference}</span> as the payment reference.</p>
              <p className="text-gray-600 dark:text-gray-400">
                {overdue
                  ? "The reservation period has ended. If you already sent the transfer, we will confirm the order once it arrives, as long as the items are still in stock."
                  : `Your items are reserved until ${formatDate(order.reservationExpiresAt)}. We confirm the order after the payment arrives.`}
              </p>
            </div>
          )}
          {order.status === "PENDING" && !order.paymentIban && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <h3 className="mb-2 font-semibold">Payment instructions</h3>
              <p className="whitespace-pre-line">{paymentFallbackMessage(order.paymentDetails)}</p>
            </div>
          )}
          {order.status === "CANCELLED" && order.reservationExpiredAt && (
            <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>
                This order was cancelled because no payment arrived by {formatDate(order.reservationExpiresAt)}.
                If you already sent {total}, <Link href="/contact" className="underline">contact us</Link> with reference <span className="font-mono">{reference}</span>.
              </p>
            </div>
          )}
          {/* Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-gray-400" />
              <h3 className="font-semibold">Summary</h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
                <span>{formatPrice(Number(order.subtotal), order.currency)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-sm text-green-700 dark:text-green-400">
                  <span>Discount{order.discountCode ? ` (${order.discountCode})` : ""}</span>
                  <span>-{formatPrice(discount, order.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Shipping</span>
                <span>{formatPrice(Number(order.shippingCost), order.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Tax</span>
                <span>{formatPrice(Number(order.tax), order.currency)}</span>
              </div>
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{total}</span>
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
