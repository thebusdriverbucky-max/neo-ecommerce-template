import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email(),
  subject: z.string().trim().min(5).max(200),
  message: z.string().trim().min(10).max(2000),
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkRateLimit(getTrustedClientIdentifier(request), "contact");

    if (!rateLimit.success) {
      return NextResponse.json(
        { error: rateLimit.unavailable ? "Contact protection is temporarily unavailable. Please try again shortly." : "Too many requests. Please try again later." },
        { status: rateLimit.unavailable ? 503 : 429 }
      );
    }

    const body = await request.json();
    const { name, email, subject, message } = contactSchema.parse(body);
    const recipient = z.string().email().safeParse(process.env.ADMIN_EMAIL?.trim());
    if (!recipient.success || !process.env.RESEND_API_KEY?.trim()) {
      return NextResponse.json({ error: "Contact email is currently unavailable" }, { status: 503 });
    }

    // Send email to admin
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">New Contact Form Submission</h2>
        
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
          <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <h3>Message:</h3>
        <p style="white-space: pre-wrap; color: #374151;">${escapeHtml(message)}</p>
      </div>
    `;

    const delivered = await sendEmail({
      to: recipient.data,
      subject: `New Contact: ${subject}`,
      html: adminHtml,
    });
    if (!delivered) return NextResponse.json({ error: "Could not deliver your message" }, { status: 503 });

    // Send confirmation email to user
    const userHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Thank You For Contacting Us</h2>
        <p>Hi ${escapeHtml(name)},</p>
        
        <p>We received your message and will respond as soon as possible.</p>
        
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
          <p><strong>Received:</strong> ${new Date().toLocaleDateString()}</p>
        </div>

        <p>Please check your spam folder if you are waiting for a reply.</p>
        
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
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
