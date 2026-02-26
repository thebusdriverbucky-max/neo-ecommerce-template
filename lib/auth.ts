import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { z } from "zod";

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
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_ID || "",
      clientSecret: process.env.GOOGLE_SECRET || "",
      allowDangerousEmailAccountLinking: true,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_ID || "",
      clientSecret: process.env.GITHUB_SECRET || "",
      allowDangerousEmailAccountLinking: true,
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
        };
      },
    }),
  ],
});
