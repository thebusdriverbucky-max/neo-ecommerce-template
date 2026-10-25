import NextAuth from "next-auth";
import { authConfig, isAdminEmail } from "./auth.config";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { findUserByEmail } from "@/lib/user-lookup";
import { logger } from "@/lib/logger";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

type RoleToken = { id?: unknown; role?: unknown; adminRecheck?: unknown } & Record<string, unknown>;

/**
 * The role lives in a 30-day JWT, so an admin token must be re-checked
 * against the database or a revoked admin would keep access until the token
 * expires. Customer tokens never reach the database.
 *
 * Returns null when the user no longer exists (ends the session) and fails
 * closed to CUSTOMER if the role cannot be confirmed. A transient database
 * error marks the token for a recheck, so the next successful lookup restores
 * a legitimate admin without signing in again.
 */
async function revalidateAdminRole<T extends RoleToken>(token: T): Promise<T | null> {
  if (token.role !== "ADMIN" && token.adminRecheck !== true) return token;

  try {
    const userId = typeof token.id === "string" ? token.id : null;
    const user = userId
      ? await db.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, role: true },
        })
      : undefined;

    if (user === null) return null;
    token.role = user && (user.role === "ADMIN" || isAdminEmail(user.email)) ? "ADMIN" : "CUSTOMER";
    delete token.adminRecheck;
  } catch {
    logger.warn("Admin role revalidation failed; treating session as customer for this request");
    token.role = "CUSTOMER";
    (token as RoleToken).adminRecheck = true;
  }

  return token;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      return revalidateAdminRole(token);
    },
  },
  adapter: PrismaAdapter(db) as any,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_ID || "",
      clientSecret: process.env.GOOGLE_SECRET || "",
      // Disabled for security: automatic linking by email allows account
      // takeover if the OAuth provider does not verify the email address.
      allowDangerousEmailAccountLinking: false,
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials) return null;

        const validatedCreds = loginSchema.safeParse(credentials);
        if (!validatedCreds.success) return null;

        const user = await findUserByEmail(db, validatedCreds.data.email);

        if (!user || !user.password) return null;

        const passwordMatch = await bcrypt.compare(
          validatedCreds.data.password,
          user.password
        );

        if (!passwordMatch) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
