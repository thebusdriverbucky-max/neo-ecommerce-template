"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Github, Mail } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginInput = z.infer<typeof loginSchema>;

export default function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const registered = searchParams.get("registered");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setLoading(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        ...data,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push(callbackUrl);
      }
    } catch (err) {
      setError("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = (provider: "github" | "google") => {
    signIn(provider, { callbackUrl });
  };

  return (
    <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow-md p-8">
      <h1 className="text-3xl font-bold mb-6 text-center">Sign In</h1>

      {registered && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          ✓ Account created! Please sign in with your credentials.
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email Address"
          type="email"
          {...register("email")}
          error={errors.email?.message}
          placeholder="you@example.com"
        />

        <div>
          <Input
            label="Password"
            type="password"
            {...register("password")}
            error={errors.password?.message}
            placeholder="••••••••"
          />
          <Link
            href="/forgot-password"
            className="text-sm text-blue-600 hover:underline mt-2 inline-block"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Don't have an account?{" "}
          <Link href="/register" className="text-blue-600 hover:underline font-medium">
            Create one
          </Link>
        </p>
      </div>

      <div className="mt-6 relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300 dark:border-gray-700"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white dark:bg-gray-900 text-gray-500">
            Or continue with
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          onClick={() => handleOAuthSignIn("github")}
        >
          <Github className="w-4 h-4" />
          GitHub
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          onClick={() => handleOAuthSignIn("google")}
        >
          <Mail className="w-4 h-4" />
          Google
        </Button>
      </div>
    </div>
  );
}
