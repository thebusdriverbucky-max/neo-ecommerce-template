"use client";

import { signIn } from "next-auth/react";

export function SocialLogin() {
  const handleSocialLogin = (provider: "google" | "github") => {
    signIn(provider, { callbackUrl: "/" });
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => handleSocialLogin("google")}
        className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
      >
        Sign in with Google
      </button>
      <button
        onClick={() => handleSocialLogin("github")}
        className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
      >
        Sign in with GitHub
      </button>
    </div>
  );
}
