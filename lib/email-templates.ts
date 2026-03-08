import { Order, OrderItem, Product, Address, StoreSettings } from "@prisma/client";

const emailWrapper = (content: string, storeName: string) => `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb;">
  <div style="background-color: #0f172a; padding: 30px; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px;">${storeName.toUpperCase()}</h1>
  </div>
  <div style="padding: 32px;">
    ${content}
  </div>
  <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} ${storeName}. All rights reserved.</p>
  </div>
</div>
`;

interface OrderConfirmationData {
  orderNumber: string;
  orderId: string;
  total: number;
  subtotal?: number;
  tax?: number;
  shippingCost?: number;
  items: { name: string; qty: number; price: number }[];
  storeName: string;
  supportEmail: string;
  storeUrl: string;
  currency?: string;
  currencySymbol?: string;
  paymentIban?: string | null;
  paymentBankName?: string | null;
  paymentAccountName?: string | null;
  paymentDetails?: string | null;
}

export const getOrderConfirmationEmailHtml = (data: OrderConfirmationData): string => {
  const { orderNumber, orderId, total, subtotal, tax, shippingCost,
    items, storeName, supportEmail, storeUrl, currency = 'USD', currencySymbol = '$',
    paymentIban, paymentBankName, paymentAccountName, paymentDetails } = data;

  const paymentInstructionsHtml = paymentIban ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px;margin:20px 0">
      <h3 style="margin:0 0 12px 0;color:#1d4ed8">Payment Instructions</h3>
      <p style="color:#374151;margin:0 0 12px 0">
        Please transfer <strong>${total.toFixed(2)} ${currency}</strong> to:
      </p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="color:#6b7280;padding:4px 0">IBAN:</td>
          <td style="font-family:monospace;font-weight:600">${paymentIban}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:4px 0">Bank:</td>
          <td style="font-weight:500">${paymentBankName || ''}</td>
        </tr>
        <tr>
          <td style="color:#6b7280;padding:4px 0">Account Name:</td>
          <td style="font-weight:500">${paymentAccountName || ''}</td>
        </tr>
      </table>
      ${paymentDetails ? `<p style="margin:12px 0 0 0;color:#6b7280;font-size:14px">${paymentDetails}</p>` : ''}
    </div>
  ` : '';

  const itemsHtml = items.map((item, i) => `
    <tr style="background: ${i % 2 === 0 ? '#ffffff' : '#f9fafb'}">
      <td style="padding:12px 16px; font-size:14px; color:#1a1a1a;">${item.name}</td>
      <td style="padding:12px 16px; font-size:14px; text-align:center; color:#6b7280;">${item.qty}</td>
      <td style="padding:12px 16px; font-size:14px; text-align:right; color:#1a1a1a;">${currencySymbol}${item.price.toFixed(2)}</td>
    </tr>
  `).join('');

  // Build price breakdown rows (only show tax/shipping if > 0)
  let breakdownHtml = '';
  if (subtotal !== undefined && (tax || shippingCost)) {
    breakdownHtml += `
      <tr>
        <td colspan="2" style="padding:8px 16px; font-size:13px; color:#6b7280; text-align:right;">Subtotal</td>
        <td style="padding:8px 16px; font-size:13px; color:#6b7280; text-align:right;">${currencySymbol}${subtotal.toFixed(2)}</td>
      </tr>
    `;
    if (shippingCost && shippingCost > 0) {
      breakdownHtml += `
        <tr>
          <td colspan="2" style="padding:4px 16px; font-size:13px; color:#6b7280; text-align:right;">Shipping</td>
          <td style="padding:4px 16px; font-size:13px; color:#6b7280; text-align:right;">${currencySymbol}${shippingCost.toFixed(2)}</td>
        </tr>
      `;
    } else if (shippingCost === 0) {
      breakdownHtml += `
        <tr>
          <td colspan="2" style="padding:4px 16px; font-size:13px; color:#16a34a; text-align:right;">Shipping</td>
          <td style="padding:4px 16px; font-size:13px; color:#16a34a; text-align:right;">FREE</td>
        </tr>
      `;
    }
    if (tax && tax > 0) {
      breakdownHtml += `
        <tr>
          <td colspan="2" style="padding:4px 16px; font-size:13px; color:#6b7280; text-align:right;">Tax</td>
          <td style="padding:4px 16px; font-size:13px; color:#6b7280; text-align:right;">${currencySymbol}${tax.toFixed(2)}</td>
        </tr>
      `;
    }
    breakdownHtml += `<tr><td colspan="3" style="border-top:1px solid #e5e7eb;"></td></tr>`;
  }

  const trackOrderUrl = storeUrl ? `${storeUrl}/orders/${orderId}` : '#';

  return `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background:#0f172a;padding:32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:3px;">
            ${storeName.toUpperCase()}
          </h1>
        </div>

        <!-- Body -->
        <div style="padding:32px;">
          <h2 style="color:#2563eb;font-size:22px;margin:0 0 8px 0;">✅ Order Confirmed!</h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 24px 0;">
            Thank you for your order! We're getting it ready to be shipped. 
            We will notify you when it has been sent.
          </p>

          <!-- Order Number Box -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin-bottom:24px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Order Number</p>
            <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;font-family:monospace;color:#1a1a1a;">
              #${orderNumber}
            </p>
          </div>

          <!-- Items Table -->
          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:12px 16px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600;">Product</th>
                <th style="padding:12px 16px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600;">Qty</th>
                <th style="padding:12px 16px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:600;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              ${breakdownHtml}
              <tr style="background:#eff6ff;">
                <td colspan="2" style="padding:14px 16px;font-size:15px;font-weight:700;color:#1e40af;text-align:right;">Total</td>
                <td style="padding:14px 16px;font-size:18px;font-weight:700;color:#2563eb;text-align:right;">${currencySymbol}${total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          ${paymentInstructionsHtml}

          <!-- Track Order Button -->
          <div style="text-align:center;margin-top:28px;">
            <a href="${trackOrderUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-size:15px;font-weight:600;">
              Track Your Order →
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="background:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0 0 4px 0;font-size:13px;color:#9ca3af;">
            You will receive a shipping confirmation email once your order ships.
          </p>
          <p style="margin:0;font-size:13px;color:#9ca3af;">
            Questions? Contact us at 
            <a href="mailto:${supportEmail}" style="color:#2563eb;">${supportEmail}</a>
          </p>
          <p style="margin:12px 0 0 0;font-size:11px;color:#d1d5db;">
            © ${new Date().getFullYear()} ${storeName}. All rights reserved.
          </p>
        </div>

      </div>
    </body>
    </html>
  `;
};

export const getOrderStatusUpdateEmailHtml = (
  orderId: string,
  status: string,
  storeName: string,
  trackingNumber?: string | null
) => {
  let trackingHtml = "";
  if (trackingNumber) {
    trackingHtml = `
      <div style="margin: 24px 0; padding: 20px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #4b5563;">Tracking Number:</p>
        <p style="margin: 0; font-family: monospace; font-size: 18px; color: #2563eb;">${trackingNumber}</p>
      </div>
    `;
  }

  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL || "";
  const orderUrl = storeUrl ? `${storeUrl}/orders/${orderId}` : '#';

  const content = `
    <h2 style="color: #1a1a1a; margin-top: 0;">Order Status Update</h2>
    <p>Your order <strong style="color: #2563eb;">${orderId}</strong> has been updated.</p>
    <p style="font-size: 18px; margin: 24px 0;">New Status: <strong style="color: #1a1a1a; background-color: #f3f4f6; padding: 4px 12px; border-radius: 9999px;">${status}</strong></p>
    ${trackingHtml}
    
    <div style="text-align:center;margin-top:28px;">
      <a href="${orderUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-size:15px;font-weight:600;">
        View Order →
      </a>
    </div>

    <p style="margin-top: 24px;">Thank you for shopping with us.</p>
  `;

  return emailWrapper(content, storeName);
};

type OrderWithDetails = Order & {
  items: (OrderItem & { product: Product })[];
  shippingAddress: Address | null;
};

export const getNewOrderNotificationEmailHtml = (order: OrderWithDetails, storeSettings: StoreSettings, currencySymbol: string = '$') => {
  const itemsHtml = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">${item.product.name}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">${currencySymbol}${item.price.toFixed(2)}</td>
        </tr>
      `
    )
    .join("");

  const shippingAddressHtml = order.shippingAddress
    ? `
      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
        <h3 style="color: #1a1a1a; margin-top: 0; margin-bottom: 16px;">Shipping Address</h3>
        <p style="margin: 0; color: #4b5563; line-height: 1.8;">
          <strong>${order.shippingAddress.firstName} ${order.shippingAddress.lastName}</strong><br>
          ${order.shippingAddress.street}<br>
          ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}<br>
          ${order.shippingAddress.country}
        </p>
      </div>
    `
    : "";

  let breakdownHtml = "";
  if (order.subtotal !== undefined && order.subtotal !== null) {
    breakdownHtml += `
      <div style="text-align: right; margin-bottom: 8px; color: #6b7280; font-size: 14px;">
        Subtotal: ${currencySymbol}${Number(order.subtotal).toFixed(2)}
      </div>
    `;
  }
  if (order.shippingCost !== undefined && order.shippingCost !== null) {
    if (Number(order.shippingCost) > 0) {
      breakdownHtml += `
        <div style="text-align: right; margin-bottom: 8px; color: #6b7280; font-size: 14px;">
          Shipping: ${currencySymbol}${Number(order.shippingCost).toFixed(2)}
        </div>
      `;
    } else if (Number(order.shippingCost) === 0) {
      breakdownHtml += `
        <div style="text-align: right; margin-bottom: 8px; color: #16a34a; font-size: 14px;">
          Shipping: FREE
        </div>
      `;
    }
  }
  if (order.tax !== undefined && order.tax !== null && Number(order.tax) > 0) {
    breakdownHtml += `
      <div style="text-align: right; margin-bottom: 8px; color: #6b7280; font-size: 14px;">
        Tax: ${currencySymbol}${Number(order.tax).toFixed(2)}
      </div>
    `;
  }

  const content = `
    <h2 style="color: #1a1a1a; margin-top: 0;">New Order Received!</h2>
    <p>You have received a new order with ID: <strong style="color: #2563eb;">${order.orderNumber}</strong></p>

    <table style="width: 100%; border-collapse: collapse; margin-top: 24px; margin-bottom: 24px;">
      <thead>
        <tr>
          <th style="padding: 12px 0; text-align: left; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-weight: 600;">Product</th>
          <th style="padding: 12px 0; text-align: center; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-weight: 600;">Qty</th>
          <th style="padding: 12px 0; text-align: right; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-weight: 600;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    ${breakdownHtml}
    <div style="text-align: right;">
      <h3 style="color: #1a1a1a; margin: 0; font-size: 20px;">Total: <span style="color: #2563eb;">${currencySymbol}${order.total.toFixed(2)}</span></h3>
    </div>

    ${shippingAddressHtml}

    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280;">
      <p style="margin: 0;">Please process this order as soon as possible.</p>
    </div>
  `;

  return emailWrapper(content, storeSettings.storeName || "Store");
};

export const getPasswordResetEmailHtml = (resetLink: string, storeName: string) => {
  const content = `
    <h2 style="color: #1a1a1a; margin-top: 0;">Password Reset</h2>
    <p>You recently requested to reset your password for your account. Click the button below to reset it.</p>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">Reset Password</a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px;">If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
    <p style="color: #6b7280; font-size: 14px; margin-top: 24px; word-break: break-all;">
      If you're having trouble clicking the password reset button, copy and paste the URL below into your web browser:<br>
      <a href="${resetLink}" style="color: #2563eb; text-decoration: none;">${resetLink}</a>
    </p>
  `;

  return emailWrapper(content, storeName);
};

export const getLowStockAlertEmailHtml = (productName: string, currentStock: number, storeName: string) => {
  const content = `
    <h2 style="color: #dc2626; margin-top: 0;">Low Stock Alert</h2>
    <p>This is an automated alert to inform you that a product is running low on stock.</p>
    
    <div style="margin: 24px 0; padding: 20px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;">
      <p style="margin: 0 0 12px 0; font-size: 16px;"><strong>Product:</strong> ${productName}</p>
      <p style="margin: 0; font-size: 16px; color: #dc2626;"><strong>Current Stock:</strong> ${currentStock}</p>
    </div>
    
    <p style="margin-top: 24px;">Please review your inventory and restock this item soon to avoid stockouts.</p>
  `;

  return emailWrapper(content, storeName);
};
