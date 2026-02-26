import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { z } from "zod";
import bcrypt from "bcryptjs";

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(6),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, password } = resetPasswordSchema.parse(body);

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return NextResponse.json({ message: "Invalid or expired token" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return NextResponse.json({ message: "Password reset successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Invalid data" }, { status: 400 });
    }
    console.error("Reset password error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
