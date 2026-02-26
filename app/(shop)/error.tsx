// app/(shop)/error.tsx

"use client";

import { Button } from "@/components/ui/Button";
import Link from "next/link";

export default function ShopError() {
  return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-3xl font-bold mb-4">Oops!</h1>
      <p className="text-gray-600 mb-8">Failed to load products</p>
      <div className="flex gap-4 justify-center">
        <Button onClick={() => window.location.reload()}>
          Refresh Page
        </Button>
        <Link href="/">
          <Button variant="outline">Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
