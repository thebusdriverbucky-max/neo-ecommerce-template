import { Resend } from "resend";
import { getAppBaseUrl } from "@/lib/app-url";
export { getAppBaseUrl } from "@/lib/app-url";
import {
  buildOrderEmailView,
  displayOrderNumber,
  getLowStockAlertEmailHtml,
  getNewOrderNotificationEmailHtml,
  getOrderConfirmationEmailHtml,
  getOrderStatusUpdateEmailHtml,
  getPaidCancelledOrderAlertEmailHtml,
  getPasswordResetEmailHtml,
} from "./email-templates";
import { createGuestOrderToken } from "./guest-order-token";
import { headerText } from "./html";
import { logger } from "./logger";
import {
  adminNotificationEmail,
  storeDisplayName,
  storeSupportEmail,
} from "./store-settings";
import { formatPrice } from "./utils";
import type {
  Address,
  Order,
  OrderItem,
  Product,
  StoreSettings,
} from "@prisma/client";

const EMAIL_FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

let resendClient: Resend | null = null;
let resendClientApiKey: string | null = null;

function getResendClient(apiKey: string): Resend {
  if (!resendClient || resendClientApiKey !== apiKey) {
    resendClient = new Resend(apiKey);
    resendClientApiKey = apiKey;
  }

  return resendClient;
}

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  /** Address that receives replies (e.g. the contact form submitter). */
  replyTo?: string;
};

export const sendEmail = async (data: EmailPayload) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // Never log the body here: it can contain password-reset links, guest
      // order tokens and customer addresses.
      console.warn(
        `RESEND_API_KEY not set. Email not sent (subject: ${headerText(data.subject)}).`,
      );
    } else {
      console.log("⚠️ RESEND_API_KEY not set. Logging email to console.");
      console.log("📧 [MOCK EMAIL] To:", data.to);
      if (data.replyTo) console.log("Reply-To:", data.replyTo);
      console.log("Subject:", data.subject);
      console.log("HTML:", data.html);
    }
    return { id: "mock-id" };
  }

  try {
    const resend = getResendClient(apiKey);
    const { data: emailData, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: data.to,
      subject: headerText(data.subject),
      html: data.html,
      ...(data.replyTo ? { replyTo: data.replyTo } : {}),
    });

    if (error) {
      console.error("❌ Error sending email:", error);
      return null;
    }

    console.log(`📧 Email sent: ${emailData?.id}`);
    return emailData;
  } catch (error) {
    console.error("❌ Error sending email:", error);
    return null;
  }
};

function orderLink(order: Pick<Order, "id" | "userId" | "guestAccessTokenExpiresAt">): string | null {
  const base = getAppBaseUrl();
  if (!base) return null;

  const url = `${base}/orders/${encodeURIComponent(order.id)}`;
  if (order.userId) return url;

  // Guests can only open their order with a signed token.
  const expiresAt = order.guestAccessTokenExpiresAt;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return null;
  try {
    return `${url}?guest_token=${encodeURIComponent(createGuestOrderToken(order.id, expiresAt))}`;
  } catch {
    return null;
  }
}

export const sendPasswordResetEmail = async (
  userEmail: string,
  resetLink: string,
  settings: StoreSettings | null = null,
) => {
  const html = getPasswordResetEmailHtml(resetLink, storeDisplayName(settings));

  return sendEmail({
    to: userEmail,
    subject: "Password Reset Request",
    html,
  });
};

// ---------------------------------------------------------------------------
// Integration contract. Callers in the payment flow use only these functions.
// ---------------------------------------------------------------------------

export type OrderEmailDetails = Order & {
  user: { email: string } | null;
  items: (OrderItem & { product: Pick<Product, "name"> })[];
  shippingAddress: Address | null;
};

export type OrderStatusEmailDetails = Pick<
  Order,
  "id" | "orderNumber" | "status" | "trackingNumber" | "userId" | "guestAccessTokenExpiresAt"
>;

/** Customer confirmation + admin "new order" notification for a paid order. */
export async function sendOrderPlacedEmails(
  order: OrderEmailDetails,
  settings: StoreSettings | null,
): Promise<void> {
  const storeName = storeDisplayName(settings);
  const view = buildOrderEmailView(order);
  const customerEmail = order.user?.email ?? order.guestEmail ?? null;

  if (customerEmail) {
    try {
      await sendEmail({
        to: customerEmail,
        subject: `Order Confirmation ${view.orderNumber}`,
        html: getOrderConfirmationEmailHtml({
          order: view,
          storeName,
          supportEmail: storeSupportEmail(settings),
          orderUrl: orderLink(order),
        }),
      });
    } catch {
      logger.error("Failed to send order confirmation email", { orderId: order.id });
    }
  }

  const adminEmail = adminNotificationEmail(settings);
  if (!adminEmail) {
    logger.warn("No store email or ADMIN_EMAIL configured; new order notification skipped", {
      orderId: order.id,
    });
    return;
  }

  try {
    await sendEmail({
      to: adminEmail,
      subject: `New Order Received! ${view.orderNumber}`,
      html: getNewOrderNotificationEmailHtml({ order: view, storeName, customerEmail }),
    });
  } catch {
    logger.error("Failed to send new order notification", { orderId: order.id });
  }
}

export async function sendOrderStatusEmail(
  to: string,
  order: OrderStatusEmailDetails,
  settings: StoreSettings | null,
): Promise<void> {
  const orderNumber = displayOrderNumber(order);

  await sendEmail({
    to,
    subject: `Order Status Update ${orderNumber}`,
    html: getOrderStatusUpdateEmailHtml({
      orderNumber,
      status: order.status,
      trackingNumber: order.trackingNumber,
      storeName: storeDisplayName(settings),
      supportEmail: storeSupportEmail(settings),
      orderUrl: orderLink(order),
    }),
  });
}

/** Alerts the admin that a payment arrived for an order that was cancelled. */
export async function sendPaidCancelledOrderAlert(
  order: Pick<Order, "id" | "orderNumber" | "total" | "currency">,
  details: { paymentIntentId: string | null; refundId: string | null; refundError?: string },
  settings: StoreSettings | null,
): Promise<void> {
  const adminEmail = adminNotificationEmail(settings);
  if (!adminEmail) {
    logger.warn("No store email or ADMIN_EMAIL configured; cancelled-order payment alert skipped", {
      orderId: order.id,
    });
    return;
  }

  const orderNumber = displayOrderNumber(order);
  await sendEmail({
    to: adminEmail,
    subject: `Action needed: payment for cancelled order ${orderNumber}`,
    html: getPaidCancelledOrderAlertEmailHtml({
      orderNumber,
      total: formatPrice(Number(String(order.total)), order.currency || "USD"),
      paymentIntentId: details.paymentIntentId,
      refundId: details.refundId,
      refundError: details.refundError,
      storeName: storeDisplayName(settings),
    }),
  });
}

export async function sendLowStockEmail(
  productName: string,
  currentStock: number,
  settings: StoreSettings | null,
): Promise<void> {
  const adminEmail = adminNotificationEmail(settings);
  if (!adminEmail) {
    logger.warn("No store email or ADMIN_EMAIL configured; low stock alert skipped");
    return;
  }

  await sendEmail({
    to: adminEmail,
    subject: `⚠️ Low Stock Alert: ${productName}`,
    html: getLowStockAlertEmailHtml(productName, currentStock, storeDisplayName(settings)),
  });
}
