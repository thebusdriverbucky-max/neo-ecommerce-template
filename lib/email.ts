import { Resend } from 'resend';
import {
  getLowStockAlertEmailHtml,
  getNewOrderNotificationEmailHtml,
  getOrderConfirmationEmailHtml,
  getOrderStatusUpdateEmailHtml,
  getPasswordResetEmailHtml,
} from './email-templates';
import { Order, OrderItem, Product, Address, StoreSettings } from "@prisma/client";

type OrderWithDetails = Order & {
  items: (OrderItem & { product: Product })[];
  shippingAddress: Address | null;
};

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export const sendEmail = async (data: EmailPayload) => {
  if (!process.env.RESEND_API_KEY) {
    console.log('⚠️ RESEND_API_KEY not set. Logging email to console.');
    console.log('📧 [MOCK EMAIL] To:', data.to);
    console.log('Subject:', data.subject);
    console.log('HTML:', data.html);
    return { id: 'mock-id' };
  }

  try {
    const { data: emailData, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: data.to,
      subject: data.subject,
      html: data.html,
    });

    if (error) {
      console.error('❌ Error sending email:', error);
      return null;
    }

    console.log(`📧 Email sent: ${emailData?.id}`);
    return emailData;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return null;
  }
};

export const sendOrderConfirmationEmail = async (
  userEmail: string,
  orderData: {
    orderNumber: string;
    orderId: string;
    total: number;
    subtotal?: number;
    tax?: number;
    shippingCost?: number;
    storeName?: string;
    items: { name: string; qty: number; price: number }[];
    currency?: string;
    paymentIban?: string | null;
    paymentBankName?: string | null;
    paymentAccountName?: string | null;
    paymentDetails?: string | null;
  }
) => {
  const storeName = orderData.storeName || process.env.NEXT_PUBLIC_STORE_NAME || 'Store';
  const supportEmail = process.env.STORE_SUPPORT_EMAIL || 'support@example.com';
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL || '';

  const html = getOrderConfirmationEmailHtml({
    orderNumber: orderData.orderNumber,
    orderId: orderData.orderId,
    total: orderData.total,
    subtotal: orderData.subtotal,
    tax: orderData.tax,
    shippingCost: orderData.shippingCost,
    items: orderData.items,
    storeName,
    supportEmail,
    storeUrl,
    currency: orderData.currency,
    paymentIban: orderData.paymentIban,
    paymentBankName: orderData.paymentBankName,
    paymentAccountName: orderData.paymentAccountName,
    paymentDetails: orderData.paymentDetails,
  });

  return sendEmail({
    to: userEmail,
    subject: `Order Confirmation ${orderData.orderNumber}`,
    html,
  });
};

export const sendOrderStatusUpdateEmail = async (
  userEmail: string,
  orderId: string,
  status: string,
  trackingNumber?: string | null
) => {
  const html = getOrderStatusUpdateEmailHtml(orderId, status, trackingNumber);

  return sendEmail({
    to: userEmail,
    subject: `Order Status Update #${orderId.slice(0, 8)}`,
    html,
  });
};

export const sendNewOrderNotificationEmail = async (order: OrderWithDetails, storeSettings: StoreSettings & { storeEmail: string }) => {
  if (!storeSettings.storeEmail) {
    console.log('⚠️ Store email not set. Skipping new order notification.');
    return;
  }

  const html = getNewOrderNotificationEmailHtml(order, storeSettings);

  return sendEmail({
    to: storeSettings.storeEmail,
    subject: `New Order Received! ${order.orderNumber}`,
    html,
  });
};

export const sendPasswordResetEmail = async (userEmail: string, resetLink: string) => {
  const html = getPasswordResetEmailHtml(resetLink);

  return sendEmail({
    to: userEmail,
    subject: 'Password Reset Request',
    html,
  });
};

export const sendLowStockAlert = async (productName: string, currentStock: number) => {
  // In a real app, you'd probably fetch the admin email from DB or env
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || 'admin@example.com';

  const html = getLowStockAlertEmailHtml(productName, currentStock);

  return sendEmail({
    to: adminEmail,
    subject: `⚠️ Low Stock Alert: ${productName}`,
    html,
  });
};
