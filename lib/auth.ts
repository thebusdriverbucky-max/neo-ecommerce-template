import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { z } from "zod";
import { checkRateLimit } from "./rate-limit";
import { getTrustedClientIdentifier } from "./request-identity";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db) as any,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      // No automatic account linking or administrative promotion, even for Google.
      if (account?.provider === "google") {
        return profile?.email_verified === true && typeof profile.email === "string" && !!profile.email.trim();
      }
      return account?.provider === "credentials";
    },
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      token.role = "CUSTOMER";
      token.roleVersion = 1;
      // Re-read roles on the server so manual revocation takes effect for API/actions.
      if (typeof token.id === "string") {
        try {
          const current = await db.user.findUnique({ where: { id: token.id }, select: { role: true, sessionVersion: true } });
          if (!current) return null;
          if (user) token.sessionVersion = (user as any).sessionVersion ?? current?.sessionVersion ?? 0;
          if (current && (token.sessionVersion ?? 0) !== (current.sessionVersion ?? 0)) return null;
          if (current?.role === "ADMIN") token.role = "ADMIN";
        } catch { /* Fail closed if role lookup is unavailable. */ }
      }
      return token;
    },
  },
  providers: [
    ...(process.env.GOOGLE_ID?.trim() && process.env.GOOGLE_SECRET?.trim() ? [GoogleProvider({
      clientId: process.env.GOOGLE_ID.trim(),
      clientSecret: process.env.GOOGLE_SECRET.trim(),
      allowDangerousEmailAccountLinking: false,
    })] : []),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials) return null;

        const limit = await checkRateLimit(getTrustedClientIdentifier(request), "auth");
        if (!limit.success) return null;

        const validatedCreds = loginSchema.safeParse(credentials);
        if (!validatedCreds.success) return null;

        const user = await db.user.findUnique({
          where: { email: validatedCreds.data.email },
        });

        if (!user || !user.password) return null;

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!passwordMatch) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
});
