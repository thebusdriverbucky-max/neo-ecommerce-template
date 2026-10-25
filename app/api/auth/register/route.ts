// app/api/auth/register/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().trim().toLowerCase().email(),
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

    // Emails are stored lowercase; check case-insensitively so legacy
    // mixed-case rows still block duplicates.
    const existingUser = await db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
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

    // Concurrent registrations with the same email lose the unique race.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return NextResponse.json(
        { message: "Email already in use" },
        { status: 400 }
      );
    }

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
