// app/api/auth/register/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await checkRateLimit(ip, "auth");

    if (!success) {
      return NextResponse.json(
        { message: "Too many requests" },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { name, email, password } = registerSchema.parse(body);

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "Email already in use" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    return NextResponse.json(
      {
        message: "User created successfully",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid input" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: "Registration failed" },
      { status: 500 }
    );
  }
}
