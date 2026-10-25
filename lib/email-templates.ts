import { escapeHtml } from "./html";
import { formatPrice } from "./utils";

// Every value interpolated into the HTML below is escaped. Customer names,
// addresses, product names, tracking numbers and store names are all
// attacker- or admin-controlled text and must never be rendered as markup.

const esc = escapeHtml;

const emailWrapper = (content: string, storeName: string) => `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb;">
  <div style="background-color: #0f172a; padding: 30px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px;">${esc(storeName.toUpperCase())}</h1>
  </div>
  <div style="padding: 32px;">
    ${content}
  </div>
  <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} ${esc(storeName)}. All rights reserved.</p>
  </div>
</div>
`;

const supportLine = (supportEmail: string | null | undefined) =>
  supportEmail
    ? `<p style="color: #6b7280; font-size: 14px; margin-top: 24px;">Questions? Contact us at <a href="mailto:${esc(supportEmail)}" style="color: #2563eb;">${esc(supportEmail)}</a></p>`
    : "";

const buttonHtml = (href: string | null | undefined, label: string) =>
  href
    ? `
    <div style="text-align:center;margin-top:28px;">
      <a href="${esc(href)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-size:15px;font-weight:600;">
        ${esc(label)}
      </a>
    </div>`
    : "";

// ---------------------------------------------------------------------------
// Order view model
// ---------------------------------------------------------------------------

type MoneyLike = number | string | { toString(): string };

export type OrderEmailSource = {
  id: string;
  orderNumber: string | null;
  currency: string;
  subtotal: MoneyLike;
  discountAmount: MoneyLike;
  shippingCost: MoneyLike;
  tax: MoneyLike;
  total: MoneyLike;
  items: { quantity: number; price: MoneyLike; product: { name: string } }[];
  shippingAddress: {
    firstName: string;
    lastName: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string | null;
  } | null;
};

export type OrderEmailView = {
  orderNumber: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  formatMoney: (amount: number) => string;
  shippingAddress: OrderEmailSource["shippingAddress"];
};

const toNumber = (value: MoneyLike | null | undefined) => {
  const parsed = Number(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The order number exactly as stored (it already contains its own "#"). */
export const displayOrderNumber = (order: { id: string; orderNumber: string | null }) =>
  order.orderNumber || `#${order.id.slice(0, 8).toUpperCase()}`;

export const buildOrderEmailView = (order: OrderEmailSource): OrderEmailView => ({
  orderNumber: displayOrderNumber(order),
  items: order.items.map((item) => ({
    name: item.product.name,
    quantity: item.quantity,
    unitPrice: toNumber(item.price),
  })),
  subtotal: toNumber(order.subtotal),
  discount: toNumber(order.discountAmount),
  shipping: toNumber(order.shippingCost),
  tax: toNumber(order.tax),
  total: toNumber(order.total),
  formatMoney: (amount) => formatPrice(amount, order.currency || "USD"),
  shippingAddress: order.shippingAddress,
});

const breakdownRow = (label: string, value: string, color = "#6b7280") => `
  <tr>
    <td colspan="2" style="padding:6px 16px; font-size:13px; color:${color}; text-align:right;">${esc(label)}</td>
    <td style="padding:6px 16px; font-size:13px; color:${color}; text-align:right;">${esc(value)}</td>
  </tr>`;

const breakdownHtml = (view: OrderEmailView) => {
  let html = breakdownRow("Subtotal", view.formatMoney(view.subtotal));
  if (view.discount > 0) {
    html += breakdownRow("Discount", `-${view.formatMoney(view.discount)}`, "#16a34a");
  }
  html +=
    view.shipping > 0
      ? breakdownRow("Shipping", view.formatMoney(view.shipping))
      : breakdownRow("Shipping", "FREE", "#16a34a");
  if (view.tax > 0) {
    html += breakdownRow("Tax", view.formatMoney(view.tax));
  }
  return html;
};

const itemRowsHtml = (view: OrderEmailView) =>
  view.items
    .map(
      (item, i) => `
    <tr style="background: ${i % 2 === 0 ? "#ffffff" : "#f9fafb"}">
      <td style="padding:12px 16px; font-size:14px; color:#1a1a1a;">${esc(item.name)}</td>
      <td style="padding:12px 16px; font-size:14px; text-align:center; color:#6b7280;">${esc(item.quantity)}</td>
      <td style="padding:12px 16px; font-size:14px; text-align:right; color:#1a1a1a;">${esc(view.formatMoney(item.unitPrice * item.quantity))}</td>
    </tr>`,
    )
    .join("");

const orderTableHtml = (view: OrderEmailView) => `
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="padding:12px 16px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600;">Product</th>
        <th style="padding:12px 16px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600;">Qty</th>
        <th style="padding:12px 16px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRowsHtml(view)}
      ${breakdownHtml(view)}
      <tr style="background:#eff6ff;">
        <td colspan="2" style="padding:14px 16px;font-size:15px;font-weight:700;color:#1e40af;text-align:right;">Total</td>
        <td style="padding:14px 16px;font-size:18px;font-weight:700;color:#2563eb;text-align:right;">${esc(view.formatMoney(view.total))}</td>
      </tr>
    </tbody>
  </table>`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const getOrderConfirmationEmailHtml = (data: {
  order: OrderEmailView;
  storeName: string;
  supportEmail: string | null;
  orderUrl: string | null;
}): string => {
  const { order, storeName, supportEmail, orderUrl } = data;

  const content = `
    <h2 style="color:#2563eb;font-size:22px;margin:0 0 8px 0;">Order Confirmed!</h2>
    <p style="color:#6b7280;font-size:15px;margin:0 0 24px 0;">
      Thank you for your order! We're getting it ready to be shipped.
      We will notify you when it has been sent.
    </p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Order Number</p>
      <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;font-family:monospace;color:#1a1a1a;">${esc(order.orderNumber)}</p>
    </div>

    ${orderTableHtml(order)}
    ${buttonHtml(orderUrl, "Track Your Order →")}
    ${supportLine(supportEmail)}
  `;

  return emailWrapper(content, storeName);
};

const statusLabel = (status: string) => {
  const lower = status.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export const getOrderStatusUpdateEmailHtml = (data: {
  orderNumber: string;
  status: string;
  trackingNumber?: string | null;
  storeName: string;
  supportEmail: string | null;
  orderUrl: string | null;
}) => {
  const { orderNumber, status, trackingNumber, storeName, supportEmail, orderUrl } = data;

  const trackingHtml = trackingNumber
    ? `
      <div style="margin: 24px 0; padding: 20px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #4b5563;">Tracking Number:</p>
        <p style="margin: 0; font-family: monospace; font-size: 18px; color: #2563eb;">${esc(trackingNumber)}</p>
      </div>`
    : "";

  const content = `
    <h2 style="color: #1a1a1a; margin-top: 0;">Order Status Update</h2>
    <p>Your order <strong style="color: #2563eb;">${esc(orderNumber)}</strong> has been updated.</p>
    <p style="font-size: 18px; margin: 24px 0;">New Status: <strong style="color: #1a1a1a; background-color: #f3f4f6; padding: 4px 12px; border-radius: 9999px;">${esc(statusLabel(status))}</strong></p>
    ${trackingHtml}
    ${buttonHtml(orderUrl, "View Order →")}
    <p style="margin-top: 24px;">Thank you for shopping with us.</p>
    ${supportLine(supportEmail)}
  `;

  return emailWrapper(content, storeName);
};

export const getNewOrderNotificationEmailHtml = (data: {
  order: OrderEmailView;
  storeName: string;
  customerEmail: string | null;
}) => {
  const { order, storeName, customerEmail } = data;
  const address = order.shippingAddress;

  const customerHtml = customerEmail
    ? `<p style="margin: 0 0 16px 0; color: #4b5563;"><strong>Customer:</strong> ${esc(customerEmail)}</p>`
    : "";

  const shippingAddressHtml = address
    ? `
      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
        <h3 style="color: #1a1a1a; margin-top: 0; margin-bottom: 16px;">Shipping Address</h3>
        <p style="margin: 0; color: #4b5563; line-height: 1.8;">
          <strong>${esc(address.firstName)} ${esc(address.lastName)}</strong><br>
          ${esc(address.street)}<br>
          ${esc(address.city)}, ${esc(address.state)} ${esc(address.postalCode)}<br>
          ${esc(address.country)}${address.phone ? `<br>${esc(address.phone)}` : ""}
        </p>
      </div>`
    : "";

  const content = `
    <h2 style="color: #1a1a1a; margin-top: 0;">New Order Received!</h2>
    <p>You have received a new order: <strong style="color: #2563eb;">${esc(order.orderNumber)}</strong></p>
    ${customerHtml}
    ${orderTableHtml(order)}
    ${shippingAddressHtml}

    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">
      <p style="margin: 0;">Please process this order as soon as possible.</p>
    </div>
  `;

  return emailWrapper(content, storeName);
};

export const getPaidCancelledOrderAlertEmailHtml = (data: {
  orderNumber: string;
  total: string;
  paymentIntentId: string | null;
  refundId: string | null;
  refundError?: string;
  storeName: string;
}) => {
  const { orderNumber, total, paymentIntentId, refundId, refundError, storeName } = data;

  const outcome = refundError
    ? `<p style="color: #dc2626;"><strong>The automatic refund FAILED.</strong> Please open the payment in Stripe and refund it manually.</p>
       <p style="color: #6b7280; font-size: 14px;">Error: ${esc(refundError)}</p>`
    : `<p>The payment was refunded automatically${refundId ? ` (refund <code>${esc(refundId)}</code>)` : ""}. No action is needed beyond checking Stripe.</p>`;

  const content = `
    <h2 style="color: #dc2626; margin-top: 0;">Payment received for a cancelled order</h2>
    <p>A payment of <strong>${esc(total)}</strong> arrived for order <strong style="color: #2563eb;">${esc(orderNumber)}</strong>, which had already been cancelled.</p>
    ${outcome}
    <div style="margin: 24px 0; padding: 20px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px;">
      <p style="margin: 0 0 8px 0;"><strong>Payment intent:</strong> <code>${esc(paymentIntentId ?? "unknown")}</code></p>
      <p style="margin: 0;"><strong>Refund:</strong> <code>${esc(refundId ?? "none")}</code></p>
    </div>
    <p style="color: #6b7280; font-size: 14px;">Please check this payment in your Stripe dashboard.</p>
  `;

  return emailWrapper(content, storeName);
};

export const getPasswordResetEmailHtml = (resetLink: string, storeName: string) => {
  const content = `
    <h2 style="color: #1a1a1a; margin-top: 0;">Password Reset</h2>
    <p>You recently requested to reset your password for your account. Click the button below to reset it.</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${esc(resetLink)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">Reset Password</a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 24px; word-break: break-all;">
      If you're having trouble clicking the password reset button, copy and paste the URL below into your web browser:<br>
      <a href="${esc(resetLink)}" style="color: #2563eb; text-decoration: none;">${esc(resetLink)}</a>
    </p>
  `;

  return emailWrapper(content, storeName);
};

export const getLowStockAlertEmailHtml = (productName: string, currentStock: number, storeName: string) => {
  const content = `
    <h2 style="color: #dc2626; margin-top: 0;">Low Stock Alert</h2>
    <p>This is an automated alert to inform you that a product is running low on stock.</p>

    <div style="margin: 24px 0; padding: 20px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;">
      <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>Product:</strong> ${esc(productName)}</p>
      <p style="margin: 0; font-size: 16px; color: #dc2626;"><strong>Current Stock:</strong> ${esc(currentStock)}</p>
    </div>

    <p style="margin-top: 24px;">Please review your inventory and restock this item soon to avoid stockouts.</p>
  `;

  return emailWrapper(content, storeName);
};

export const getContactMessageEmailHtml = (data: {
  name: string;
  email: string;
  subject: string;
  message: string;
  storeName: string;
}) => {
  const { name, email, subject, message, storeName } = data;

  const content = `
    <h2 style="color: #2563eb; margin-top: 0;">New Contact Form Submission</h2>
    <p style="color: #6b7280; font-size: 14px;">Reply to this email to answer the sender directly.</p>

    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>From:</strong> ${esc(name)} (${esc(email)})</p>
      <p style="margin: 0 0 8px 0;"><strong>Subject:</strong> ${esc(subject)}</p>
      <p style="margin: 0;"><strong>Date:</strong> ${esc(new Date().toUTCString())}</p>
    </div>

    <h3>Message:</h3>
    <p style="white-space: pre-wrap; color: #374151;">${esc(message)}</p>
  `;

  return emailWrapper(content, storeName);
};
