import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(8).max(100),
});

export async function POST(req: Request) {
  try {
    // Rate limit token guessing attempts
    const rateLimit = await checkRateLimit(getTrustedClientIdentifier(req), "forgotPassword");
    if (!rateLimit.success) {
      return NextResponse.json(
        { message: rateLimit.unavailable ? "Password reset protection is temporarily unavailable" : "Too many requests" },
        { status: rateLimit.unavailable ? 503 : 429 },
      );
    }

    const body = await req.json();
    const { token, password } = resetPasswordSchema.parse(body);

    // Tokens are stored hashed — hash the incoming token before lookup
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetTokenExpiry: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return NextResponse.json({ message: "Invalid or expired token" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Compare-and-clear prevents concurrent reuse of a valid reset token.
    const changed = await prisma.user.updateMany({
      where: { id: user.id, resetToken: hashedToken, resetTokenExpiry: { gt: new Date() } },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    if (changed.count !== 1) {
      return NextResponse.json({ message: "Invalid or expired token" }, { status: 400 });
    }

    return NextResponse.json({ message: "Password reset successfully" });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ message: "Invalid data" }, { status: 400 });
    }
    console.error("Reset password error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
