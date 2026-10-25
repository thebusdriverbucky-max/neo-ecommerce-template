import { Resend } from "resend";
import {
  buildOrderEmailView,
  displayOrderNumber,
  getLowStockAlertEmailHtml,
  getNewOrderNotificationEmailHtml,
  getOrderConfirmationEmailHtml,
  getOrderStatusUpdateEmailHtml,
  getPasswordResetEmailHtml,
} from "./email-templates";
import { getAppBaseUrl } from "./app-url";
import { createGuestOrderToken, guestOrderTokensConfigured } from "./guest-order-token";
import { headerText } from "./html";
import { logger } from "./logger";
import {
  adminNotificationEmail,
  storeDisplayName,
  storeSupportEmail,
} from "./store-settings";
import type {
  Address,
  Order,
  OrderItem,
  Product,
  StoreSettings,
} from "@prisma/client";

// Note: the default sender can only deliver to the Resend account owner.
// Set EMAIL_FROM to an address on a domain verified in Resend for real customers.
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

/** Provider failure reason for logs, with any email address removed. */
function failureReason(error: unknown): { reason: string; message: string } {
  const source = (error && typeof error === "object" ? error : {}) as { name?: unknown; message?: unknown };
  const name = typeof source.name === "string" && source.name ? source.name : "Error";
  const message = typeof source.message === "string" ? source.message : String(error ?? "");
  return {
    reason: name.slice(0, 100),
    message: message.replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, "[email]").slice(0, 300),
  };
}

export const sendEmail = async (data: EmailPayload) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  // Disabled email is not a successful delivery. Never log the recipient, the
  // subject or the body: they can contain reset links, order tokens and addresses.
  if (!apiKey) {
    logger.warn("RESEND_API_KEY is not set; email was not sent");
    return null;
  }

  try {
    const { data: emailData, error } = await getResendClient(apiKey).emails.send({
      from: EMAIL_FROM,
      to: data.to,
      subject: headerText(data.subject),
      html: data.html,
      ...(data.replyTo ? { replyTo: data.replyTo } : {}),
    });

    if (error) {
      logger.error("Email delivery failed", failureReason(error));
      return null;
    }

    return emailData;
  } catch (error) {
    logger.error("Email delivery failed", failureReason(error));
    return null;
  }
};

/**
 * Link to the order page. Guests get a signed token (never stored); the link
 * is omitted when there is no public base URL or the token cannot be signed.
 */
function orderLink(order: Pick<Order, "id" | "userId">): string | null {
  const base = getAppBaseUrl();
  if (!base) return null;

  const url = `${base}/orders/${encodeURIComponent(order.id)}`;
  if (order.userId) return url;

  if (!guestOrderTokensConfigured()) return null;
  try {
    return `${url}?token=${encodeURIComponent(createGuestOrderToken(order.id))}`;
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
// Order flow helpers. None of them throws: a failed email must never fail or
// roll back the order operation that triggered it.
// ---------------------------------------------------------------------------

export type OrderEmailDetails = Order & {
  user: { email: string } | null;
  items: (OrderItem & { product: Pick<Product, "name"> })[];
  shippingAddress: Address | null;
};

export type OrderStatusEmailDetails = Pick<
  Order,
  "id" | "orderNumber" | "status" | "trackingNumber" | "userId"
>;

/** Customer "bank transfer required" email + admin "new order" notification. */
export async function sendOrderPlacedEmails(
  order: OrderEmailDetails,
  settings: StoreSettings | null,
): Promise<void> {
  const storeName = storeDisplayName(settings);
  const customerEmail = order.user?.email ?? order.guestEmail ?? null;

  let view: ReturnType<typeof buildOrderEmailView>;
  try {
    view = buildOrderEmailView(order);
  } catch {
    logger.error("Failed to prepare order emails", { orderId: order.id });
    return;
  }

  if (customerEmail) {
    try {
      await sendEmail({
        to: customerEmail,
        subject: `Order received ${view.orderNumber} — bank transfer required`,
        html: getOrderConfirmationEmailHtml({
          order: view,
          storeName,
          supportEmail: storeSupportEmail(settings),
          orderUrl: orderLink(order),
        }),
      });
    } catch {
      logger.error("Failed to send order received email", { orderId: order.id });
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
      subject: `New order ${view.orderNumber} — awaiting bank transfer`,
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
  try {
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
  } catch {
    logger.error("Failed to send order status email", { orderId: order.id });
  }
}

/** Returns true when the alert was handed to the email provider. */
export async function sendLowStockEmail(
  productName: string,
  currentStock: number,
  settings: StoreSettings | null,
): Promise<boolean> {
  const adminEmail = adminNotificationEmail(settings);
  if (!adminEmail) {
    logger.warn("No store email or ADMIN_EMAIL configured; low stock alert skipped");
    return false;
  }

  try {
    const sent = await sendEmail({
      to: adminEmail,
      subject: `⚠️ Low Stock Alert: ${headerText(productName, 120)}`,
      html: getLowStockAlertEmailHtml(productName, currentStock, storeDisplayName(settings)),
    });
    return sent !== null;
  } catch {
    logger.error("Failed to send low stock alert");
    return false;
  }
}
