"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateProfile } from "@/app/profile/actions";
import { useRouter } from "next/navigation";

interface ProfileFormProps {
  user: {
    name: string | null;
    email: string | null;
    role: string;
    createdAt: Date;
  };
}

export function ProfileForm({ user }: ProfileFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: user.name || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      setMessage({ type: "error", text: "New passwords do not match" });
      setIsLoading(false);
      return;
    }

    try {
      await updateProfile({
        name: formData.name,
        currentPassword: formData.currentPassword || undefined,
        newPassword: formData.newPassword || undefined,
      });
      setMessage({ type: "success", text: "Profile updated successfully" });
      setFormData((prev) => ({
        ...prev,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      }));
      router.refresh();
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed to update profile" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {message && (
        <div
          className={`p-4 mb-6 rounded-md ${message.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
            }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Profile Section */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-xl font-semibold mb-4">Profile Information</h2>
          <div className="space-y-4">
            <Input
              label="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Your name"
            />
            <Input
              label="Email"
              type="email"
              value={user.email || ""}
              disabled
              helperText="Email cannot be changed"
            />
          </div>
        </div>

        {/* Account Info */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-xl font-semibold mb-4">Account Information</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Role:</span>
              <span className="font-medium">{user.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Member since:</span>
              <span className="font-medium">
                {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Password Section */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-xl font-semibold mb-4">Change Password</h2>
          <div className="space-y-4">
            <Input
              label="Current Password"
              type="password"
              value={formData.currentPassword}
              onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
              placeholder="••••••••"
            />
            <Input
              label="New Password"
              type="password"
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              placeholder="••••••••"
            />
            <Input
              label="Confirm New Password"
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              placeholder="••••••••"
            />
          </div>
        </div>

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? "Saving..." : "Save Changes"}
        </Button>
      </form>
    </div>
  );
}
