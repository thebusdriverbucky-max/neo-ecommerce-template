"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Trash2, Edit2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/components/providers/settings-provider";
import { formatPrice } from "@/lib/utils";
import { discountAvailabilityError, discountSchema } from "@/lib/discounts";
import { discountFieldErrors } from "@/lib/discount-feedback";

interface DiscountCode {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  expiresAt: string | null;
  isActive: boolean;
}

export default function AdminDiscountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [discounts, setDiscounts] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { currency } = useSettings();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [originalExpiry, setOriginalExpiry] = useState<string | null>(null);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const [formData, setFormData] = useState({
    code: "",
    type: "PERCENT",
    value: "",
    expiresAt: "",
    isActive: true,
  });

  const fetchDiscounts = useCallback(async () => {
    setListError("");
    try {
      const response = await fetch("/api/discounts");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch discounts");
      setDiscounts(data);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to fetch discounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (session?.user?.role !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (session?.user?.role === "ADMIN") {
      fetchDiscounts();
    }
  }, [session, fetchDiscounts]);

  const handleSubmit = async () => {
    if (savingRef.current) return;
    setFormError("");
    setFieldErrors({});
    // Editing an unrelated field must not silently extend a legacy timestamp.
    const expiresAt = originalExpiry && formData.expiresAt === originalExpiry.slice(0, 10)
      ? originalExpiry : formData.expiresAt || null;
    const parsed = discountSchema.safeParse({ ...formData, expiresAt });
    if (!parsed.success) {
      setFieldErrors(discountFieldErrors(parsed.error.issues));
      setFormError("Please correct the highlighted fields.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const url = editingId ? `/api/discounts/${editingId}` : "/api/discounts";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(data.fieldErrors || {});
        setFormError(data.error || "Failed to save discount");
        return;
      }
      await fetchDiscounts();
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      setFormError("Unable to save the discount. Check your connection and try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");

    try {
      const response = await fetch(`/api/discounts/${deleteId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        setDeleteError(data.error || "Failed to delete discount");
        return;
      }
      await fetchDiscounts();
      setDeleteDialogOpen(false);
      setDeleteId(null);
    } catch (error) {
      setDeleteError("Unable to delete the discount. Check your connection and try again.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const handleEdit = (discount: DiscountCode) => {
    setFormError("");
    setFieldErrors({});
    setOriginalExpiry(discount.expiresAt ? new Date(discount.expiresAt).toISOString() : null);
    setEditingId(discount.id);
    setFormData({
      code: discount.code,
      type: discount.type,
      value: discount.value.toString(),
      expiresAt: discount.expiresAt ? new Date(discount.expiresAt).toISOString().split('T')[0] : "",
      isActive: discount.isActive,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setFormError("");
    setFieldErrors({});
    setOriginalExpiry(null);
    setFormData({
      code: "",
      type: "PERCENT",
      value: "",
      expiresAt: "",
      isActive: true,
    });
    setEditingId(null);
  };

  const handleOpenDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const discountTypes = [
    { value: "PERCENT", label: "Percentage (%)" },
    { value: "FIXED", label: `Fixed Amount (${currency})` },
  ];

  if (status === "loading" || session?.user?.role !== "ADMIN") {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Discounts</h1>
        <Button onClick={handleOpenDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Discount
        </Button>
      </div>

      {listError && <div className="mb-4"><p role="alert" className="text-red-600">{listError}</p><Button variant="outline" onClick={fetchDiscounts}>Retry</Button></div>}
      {loading && <p className="mb-4">Loading discounts...</p>}
      {/* Discounts Table */}
      <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full">
          <thead className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="text-left px-6 py-3 font-semibold">Code</th>
              <th className="text-left px-6 py-3 font-semibold">Type</th>
              <th className="text-left px-6 py-3 font-semibold">Value</th>
              <th className="text-left px-6 py-3 font-semibold">Expires At</th>
              <th className="text-left px-6 py-3 font-semibold">Status</th>
              <th className="text-left px-6 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {discounts.map((discount) => (
              <tr
                key={discount.id}
                className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <td className="px-6 py-4 font-mono">{discount.code}</td>
                <td className="px-6 py-4">{discount.type}</td>
                <td className="px-6 py-4">
                  {discount.type === "PERCENT" ? `${discount.value}%` : formatPrice(discount.value, currency)}
                </td>
                <td className="px-6 py-4" title={discount.expiresAt ? new Date(discount.expiresAt).toISOString() : undefined}>
                  {discount.expiresAt ? `${new Date(discount.expiresAt).toISOString().slice(0, 10)} (UTC)` : "Never"}
                </td>
                <td className="px-6 py-4">
                  <span className={discountAvailabilityError(discount) ? "text-red-600" : "text-green-600"}>
                    {discountAvailabilityError(discount) || "Active"}
                  </span>
                </td>
                <td className="px-6 py-4 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(discount)}
                    className="gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setDeleteId(discount.id);
                      setDeleteError("");
                      setDeleteDialogOpen(true);
                    }}
                    className="gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => { if (!savingRef.current) setDialogOpen(open); }}
        title={editingId ? "Edit Discount" : "Add Discount"}
        onConfirm={handleSubmit}
        confirmText={editingId ? "Update" : "Create"}
        closeOnConfirm={false}
        isLoading={saving}
      >
        <div className="space-y-4">
          {formError && <p role="alert" className="text-red-600 text-sm">{formError}</p>}
          <Input
            id="discount-code"
            label="Code"
            maxLength={50}
            error={fieldErrors.code}
            disabled={saving}
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            required
          />
          <Select
            id="discount-type"
            label="Type"
            error={fieldErrors.type}
            disabled={saving}
            options={discountTypes}
            value={formData.type}
            onChange={(e) =>
              setFormData({ ...formData, type: e.target.value as "PERCENT" | "FIXED" })
            }
            required
          />
          <Input
            id="discount-value"
            label={formData.type === "PERCENT" ? "Percentage (%)" : `Amount (${currency})`}
            type="number"
            step="0.01"
            min="0.01"
            max={formData.type === "PERCENT" ? 100 : 1000000}
            error={fieldErrors.value}
            disabled={saving}
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            required
          />
          <Input
            id="discount-expiry"
            label="Last valid day (UTC)"
            helperText="Valid through 23:59:59 UTC on the selected day. Leave blank for no expiry. Existing exact expiry times are preserved until you change the date."
            error={fieldErrors.expiresAt}
            disabled={saving}
            type="date"
            value={formData.expiresAt}
            onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={saving}
              checked={formData.isActive}
              onChange={(e) =>
                setFormData({ ...formData, isActive: e.target.checked })
              }
              className="rounded"
            />
            <span>Active</span>
          </label>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => { if (!deletingRef.current) setDeleteDialogOpen(open); }}
        title="Delete Discount"
        description="Are you sure you want to delete this discount code? This action cannot be undone."
        onConfirm={handleDelete}
        closeOnConfirm={false}
        isLoading={deleting}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
      >
        {deleteError && <p role="alert" className="text-red-600 text-sm">{deleteError}</p>}
      </Dialog>
    </div>
  );
}
