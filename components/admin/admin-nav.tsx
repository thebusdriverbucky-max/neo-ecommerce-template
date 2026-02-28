"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Tag } from "lucide-react";

export function AdminNav() {
  const pathname = usePathname();

  const navLinks = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/products", label: "Products" },
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/discounts", label: "Discounts" },
    { href: "/admin/settings", label: "Settings" },
  ];

  return (
    <div className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-6">
            <Link href="/admin">
              <h2 className="text-2xl font-bold whitespace-nowrap">Admin Dashboard</h2>
            </Link>
            <nav className="hidden md:flex items-center space-x-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${pathname === link.href
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center">
            <Link
              href="/admin/settings"
              className="flex items-center gap-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 p-2 rounded-full transition-colors"
            >
              <Settings className="w-8 h-8" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
