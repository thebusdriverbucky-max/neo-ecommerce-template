// app/api/auth/register/route.ts

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIdentifier } from "@/lib/request-identity";
import { findUserByEmail, normalizeEmail } from "@/lib/user-lookup";

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
});

function duplicateEmail() {
  return NextResponse.json({ message: "Email already in use" }, { status: 409 });
}

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
    const normalizedEmail = normalizeEmail(email);

    // Emails are stored lowercase; the lookup is case-insensitive so legacy
    // mixed-case rows still block duplicates.
    const existingUser = await findUserByEmail(db, normalizedEmail);

    if (existingUser) {
      return duplicateEmail();
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
    // A concurrent registration with the same email lost the unique race.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return duplicateEmail();
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { message: "Invalid input" },
        { status: 400 }
      );
    }

    logger.error("Registration failed");
    return NextResponse.json(
      { message: "Registration failed" },
      { status: 500 }
    );
  }
}
