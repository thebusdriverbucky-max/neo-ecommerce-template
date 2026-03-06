// File: components/layout/navbar.tsx

"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart-store";
import { useWishlist } from "@/lib/wishlist-store";
import { ShoppingCart, User, Menu, X, Sun, Moon, Heart } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useState, useRef, useEffect, Suspense } from "react";
import { useTheme } from "next-themes";
import { getSettings, StoreSettingsData } from "@/app/actions/settings";

export function Navbar() {
  const [settings, setSettings] = useState<StoreSettingsData | null>(null);
  const storeName = settings?.storeName || process.env.NEXT_PUBLIC_STORE_NAME || 'Store';
  const pathname = usePathname();
  const { data: session } = useSession();
  const { getTotalItems } = useCart();
  const { items: wishlistItems } = useWishlist();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const fetchSettings = async () => {
      const result = await getSettings();
      if (result.success && result.data) {
        setSettings(result.data as unknown as StoreSettingsData);
      }
    };
    fetchSettings();
  }, []);

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <nav className="bg-white dark:bg-gray-900 sticky top-0 z-50 shadow-md">
      <div className="container mx-auto px-4 pt-6 pb-2 md:py-4">
        <div className="relative flex items-center justify-between">

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-gray-700 dark:text-gray-300"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          {/* Left: Navigation Links (Desktop) */}
          <div className="hidden md:flex gap-6 items-center flex-1">
            <Link
              href="/"
              className={`text-lg font-medium transition-colors relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:bg-blue-600 after:transition-all after:duration-300 ${pathname === "/"
                ? "text-blue-600 after:w-full"
                : "text-gray-700 dark:text-gray-300 hover:text-blue-600 after:w-0 hover:after:w-full"
                }`}
            >
              Home
            </Link>
            <Link
              href="/products"
              className={`text-lg font-medium transition-colors relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:bg-blue-600 after:transition-all after:duration-300 ${pathname.startsWith("/products")
                ? "text-blue-600 after:w-full"
                : "text-gray-700 dark:text-gray-300 hover:text-blue-600 after:w-0 hover:after:w-full"
                }`}
            >
              All Products
            </Link>
            {session?.user?.role === "ADMIN" && (
              <Link
                href="/admin"
                className={`text-lg font-medium transition-colors relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:bg-blue-600 after:transition-all after:duration-300 ${pathname.startsWith("/admin")
                  ? "text-blue-600 after:w-full"
                  : "text-gray-700 dark:text-gray-300 hover:text-blue-600 after:w-0 hover:after:w-full"
                  }`}
              >
                Admin
              </Link>
            )}
          </div>

          {/* Center: Logo */}
          <Link
            href="/"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl font-bold text-blue-600"
          >
            {storeName}
          </Link>

          {/* Right: Search + Cart + Auth */}
          <div className="flex gap-4 items-center flex-1 justify-end">
            <div className="hidden md:block">
              <Suspense fallback={<div className="w-64 h-10 bg-gray-100 rounded-full animate-pulse" />}>
                <SearchInput />
              </Suspense>
            </div>

            <Link href="/cart" className="relative">
              <ShoppingCart className="w-7 h-7 text-gray-700 dark:text-gray-300 hover:text-blue-600 transition-colors" />
              {mounted && getTotalItems() > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                  {getTotalItems() > 99 ? '99+' : getTotalItems()}
                </span>
              )}
            </Link>

            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <User className="w-6 h-6 text-gray-700 dark:text-gray-300" />
              </button>

              {/* User Dropdown */}
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 border border-gray-200 dark:border-gray-700">
                  {session ? (
                    <>
                      <Link
                        href="/profile"
                        className="block px-4 py-2 text-base text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        My Profile
                      </Link>
                      <Link
                        href="/wishlist"
                        className="flex items-center justify-between px-4 py-2 text-base text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        <span>My Wishlist</span>
                        {mounted && wishlistItems.length > 0 && (
                          <span className="bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                            {wishlistItems.length > 9 ? '9+' : wishlistItems.length}
                          </span>
                        )}
                      </Link>
                      {session.user.role === "ADMIN" && (
                        <Link
                          href="/admin"
                          className="block px-4 py-2 text-base text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          Admin
                        </Link>
                      )}
                      <button
                        onClick={() => signOut()}
                        className="block w-full text-left px-4 py-2 text-base text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        Sign Out
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href={`/login?callbackUrl=${pathname}`}
                        className="block px-4 py-2 text-base text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        Sign In
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Search (visible below header on mobile) */}
        <div className="mt-4 md:hidden">
          <Suspense fallback={<div className="w-full h-10 bg-gray-100 rounded-full animate-pulse" />}>
            <SearchInput />
          </Suspense>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex flex-col gap-4">
              <Link
                href="/"
                className={`text-lg font-medium transition-colors w-fit relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:bg-blue-600 after:transition-all after:duration-300 ${pathname === "/"
                  ? "text-blue-600 after:w-full"
                  : "text-gray-700 dark:text-gray-300 hover:text-blue-600 after:w-0 hover:after:w-full"
                  }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Home
              </Link>
              <Link
                href="/products"
                className={`text-lg font-medium transition-colors w-fit relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:bg-blue-600 after:transition-all after:duration-300 ${pathname.startsWith("/products")
                  ? "text-blue-600 after:w-full"
                  : "text-gray-700 dark:text-gray-300 hover:text-blue-600 after:w-0 hover:after:w-full"
                  }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                All Products
              </Link>
              {session?.user?.role === "ADMIN" && (
                <Link
                  href="/admin"
                  className={`text-lg font-medium transition-colors w-fit relative after:absolute after:left-0 after:-bottom-1 after:h-0.5 after:bg-blue-600 after:transition-all after:duration-300 ${pathname.startsWith("/admin")
                    ? "text-blue-600 after:w-full"
                    : "text-gray-700 dark:text-gray-300 hover:text-blue-600 after:w-0 hover:after:w-full"
                    }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Admin
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
