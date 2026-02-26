"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    if (!token) {
      setError("Missing reset token");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          password: data.password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Something went wrong");
      }

      setMessage("Password has been reset successfully. You can now log in.");
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow-md p-8 text-center">
        <h1 className="text-2xl font-bold mb-4 text-red-600">Invalid Request</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Missing reset token. Please check the link you received.
        </p>
        <Link href="/login" className="text-blue-600 hover:underline font-medium">
          Back to Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-lg shadow-md p-8">
      <h1 className="text-3xl font-bold mb-6 text-center">Reset Password</h1>

      {message && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="New Password"
          type="password"
          {...register("password")}
          error={errors.password?.message}
          placeholder="••••••••"
        />

        <Input
          label="Confirm New Password"
          type="password"
          {...register("confirmPassword")}
          error={errors.confirmPassword?.message}
          placeholder="••••••••"
        />

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Resetting..." : "Reset Password"}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 py-12 px-4">
      <Suspense fallback={<div className="text-center">Loading...</div>}>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
