"use client";

import { getProviders, signIn } from "next-auth/react";
import { useEffect, useState } from "react";

export function SocialLogin({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    getProviders().then(providers => {
      if (active) setEnabled(Boolean(providers?.google));
    }).catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);
  const handleSocialLogin = (provider: "google") => {
    signIn(provider, { callbackUrl });
  };

  if (!enabled) return null;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => handleSocialLogin("google")}
        className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
      >
        Sign in with Google
      </button>
    </div>
  );
}
