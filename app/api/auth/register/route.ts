// app/api/auth/register/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkRateLimit(getTrustedClientIdentifier(request), "auth");

    if (!rateLimit.success) {
      return NextResponse.json(
        { message: rateLimit.unavailable ? "Registration protection is temporarily unavailable" : "Too many requests" },
        { status: rateLimit.unavailable ? 503 : 429 }
      );
    }

    const body = await request.json();
    const { name, email, password } = registerSchema.parse(body);
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
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
        email: normalizedEmail,
        password: hashedPassword,
        role: "CUSTOMER",
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
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { message: "Invalid input" },
        { status: 400 }
      );
    }

    console.error("Registration failed");
    return NextResponse.json(
      { message: "Registration failed" },
      { status: 500 }
    );
  }
}
