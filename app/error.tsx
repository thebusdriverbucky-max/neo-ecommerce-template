// app/error.tsx

"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-4xl font-bold mb-4">Something went wrong!</h1>
      <p className="text-gray-600 mb-8">{error.message || "An unexpected error occurred"}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
