import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";

const contactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  subject: z.string().min(5).max(200),
  message: z.string().min(10).max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateLimit = await checkRateLimit(ip, "contact");

    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { name, email, subject, message } = contactSchema.parse(body);

    // Send email to admin
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">New Contact Form Submission</h2>
        
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>From:</strong> ${name} (${email})</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <h3>Message:</h3>
        <p style="white-space: pre-wrap; color: #374151;">${message}</p>
      </div>
    `;

    await sendEmail({
      to: process.env.ADMIN_EMAIL || "admin@store.com",
      subject: `New Contact: ${subject}`,
      html: adminHtml,
    });

    // Send confirmation email to user
    const userHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Thank You For Contacting Us</h2>
        <p>Hi ${name},</p>
        
        <p>We received your message and will get back to you as soon as possible, typically within 24-48 hours.</p>
        
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Received:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <p>If you don't hear from us within 48 hours, please check your spam folder or contact us directly at support@store.com</p>
        
        <p>Best regards,<br/>The Support Team</p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: `Re: ${subject}`,
      html: userHtml,
    });

    return NextResponse.json(
      { success: true, message: "Message sent successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
