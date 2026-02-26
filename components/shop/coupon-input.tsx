// components/shop/coupon-input.tsx

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AlertCircle, Check } from "lucide-react";

interface CouponInputProps {
  onApplyCoupon: (discount: { code: string; type: "PERCENT" | "FIXED"; value: number }) => void;
  orderTotal: number;
}

export function CouponInput({ onApplyCoupon, orderTotal }: CouponInputProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);

  const handleValidateCoupon = async () => {
    if (!code.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.toUpperCase(), orderAmount: orderTotal }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error);
        return;
      }

      setDiscountAmount(data.discount);
      setSuccess(true);

      // Pass the full discount object to the parent
      onApplyCoupon({
        code: data.code,
        type: data.type,
        value: data.value
      });

    } catch (err) {
      setError("Failed to apply coupon");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">Coupon Code</label>
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setSuccess(false);
            setError(null);
          }}
          placeholder="SUMMER20"
          disabled={success}
        />
        <Button
          onClick={handleValidateCoupon}
          disabled={loading || success || !code.trim()}
          variant={success ? "outline" : "default"}
        >
          {success ? <Check className="w-4 h-4" /> : "Apply"}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <Check className="w-4 h-4" />
          Discount applied: ${discountAmount.toFixed(2)}
        </div>
      )}
    </div>
  );
}
