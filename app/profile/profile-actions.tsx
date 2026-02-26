// File: app/profile/profile-actions.tsx

"use client";

import { signOut } from "next-auth/react";
import { deleteAccount } from "./actions";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function ProfileActions() {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      setIsDeleting(true);
      try {
        await deleteAccount();
      } catch (error) {
        console.error(error);
        alert("Failed to delete account");
        setIsDeleting(false);
      }
    }
  };

  return (
    <div className="flex gap-4">
      <Button
        onClick={() => signOut({ callbackUrl: "/" })}
        variant="default"
      >
        Sign Out
      </Button>

      <Button
        onClick={handleDelete}
        disabled={isDeleting}
        variant="destructive"
      >
        {isDeleting ? "Deleting..." : "Delete Account"}
      </Button>
    </div>
  );
}
