import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { z } from "zod";
import crypto from "crypto";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateLimit = await checkRateLimit(ip, "forgotPassword");

    if (!rateLimit.success) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }

    const body = await req.json();
    const { email } = forgotPasswordSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Возвращаем 200 OK даже если пользователя нет, чтобы не раскрывать наличие email
      return NextResponse.json({ message: "If an account exists with this email, you will receive a password reset link." });
    }

    // Генерация токена
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 час

    await prisma.user.update({
      where: { email },
      data: {
        resetToken,
        resetTokenExpiry,
      },
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/reset-password?token=${resetToken}`;

    await sendPasswordResetEmail(email, resetUrl);

    return NextResponse.json({ message: "If an account exists with this email, you will receive a password reset link." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid email" }, { status: 400 });
    }
    console.error("Forgot password error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
