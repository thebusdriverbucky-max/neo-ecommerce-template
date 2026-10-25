import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { z } from "zod";
import crypto from "crypto";
import { getAppBaseUrl, sendPasswordResetEmail } from "@/lib/email";
import { getStoreSettings } from "@/lib/store-settings";
import { findUserByEmail } from "@/lib/user-lookup";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(req: Request) {
  try {
    const ip = getTrustedClientIdentifier(req);
    const rateLimit = await checkRateLimit(ip, "forgotPassword");

    if (!rateLimit.success) {
      return new NextResponse(
        rateLimit.unavailable ? "Password reset protection is temporarily unavailable" : "Too Many Requests",
        { status: rateLimit.unavailable ? 503 : 429 },
      );
    }

    const body = await req.json();
    const { email } = forgotPasswordSchema.parse(body);

    const user = await findUserByEmail(prisma, email);

    if (!user) {
      // Return 200 OK even if the user does not exist, so as not to reveal whether the email is registered
      return NextResponse.json({ message: "If an account exists with this email, you will receive a password reset link." });
    }

    // Generate token. The database stores only the SHA-256 hash —
    // a database leak will not allow the tokens to be recovered.
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry,
      },
    });

    // Links in emails use the configured public URL. The localhost fallback
    // is only for local development; in production a missing URL would
    // produce an unusable link, so nothing is sent.
    const baseUrl = getAppBaseUrl() ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");
    if (!baseUrl) {
      console.error("Forgot password: NEXT_PUBLIC_APP_URL is not set; reset email not sent");
      return NextResponse.json({ message: "If an account exists with this email, you will receive a password reset link." });
    }

    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Always send to the address stored on the account.
    await sendPasswordResetEmail(user.email, resetUrl, await getStoreSettings());

    return NextResponse.json({ message: "If an account exists with this email, you will receive a password reset link." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid email" }, { status: 400 });
    }
    console.error("Forgot password error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
