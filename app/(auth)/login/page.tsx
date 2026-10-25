import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LoginContent from "@/components/auth/login-content";

export default async function LoginPage({ searchParams }: { searchParams?: { passwordChanged?: string } }) {
  const session = await auth();

  if (session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-950 py-12 px-4">
      {searchParams?.passwordChanged && (
        <div className="w-full max-w-md p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          Your password was changed and you were signed out on all devices. Please sign in with your new password.
        </div>
      )}
      <Suspense fallback={<div className="text-center">Loading...</div>}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
