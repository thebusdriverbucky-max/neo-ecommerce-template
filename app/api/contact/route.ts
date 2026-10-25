import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { getContactMessageEmailHtml } from "@/lib/email-templates";
import { headerText } from "@/lib/html";
import { getStoreSettings, adminNotificationEmail, storeDisplayName } from "@/lib/store-settings";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(5).max(200),
  message: z.string().trim().min(10).max(2000),
});

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

    // Honeypot: bots fill every field. Pretend it worked and send nothing.
    if (typeof body?.website === "string" && body.website.trim() !== "") {
      return NextResponse.json({ success: true, message: "Message sent successfully" }, { status: 200 });
    }

    const { name, email, subject, message } = contactSchema.parse(body);

    const settings = await getStoreSettings();
    const adminEmail = adminNotificationEmail(settings);

    if (!adminEmail) {
      console.error("Contact form: no store email or ADMIN_EMAIL configured; message dropped");
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    // Only the store owner is notified. The submitter is never emailed
    // automatically: an auto-reply to an arbitrary address would let anyone
    // send mail from the store's domain. The owner replies via Reply-To.
    await sendEmail({
      to: adminEmail,
      replyTo: email,
      subject: headerText(`New Contact: ${subject}`),
      html: getContactMessageEmailHtml({
        name,
        email,
        subject,
        message,
        storeName: storeDisplayName(settings),
      }),
    });

    return NextResponse.json(
      { success: true, message: "Message sent successfully" },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
