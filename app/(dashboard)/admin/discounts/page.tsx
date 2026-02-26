"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Trash2, Edit2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

interface DiscountCode {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  expiresAt: string | null;
  isActive: boolean;
}

export default function AdminDiscountsPage() {
  const { data: session, status } = useSession(); // <-- Получите status
  const router = useRouter(); // <-- Инициализируйте роутер
  const [discounts, setDiscounts] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    type: "PERCENT",
    value: "",
    expiresAt: "",
    isActive: true,
  });

  useEffect(() => {
    // Этот эффект будет следить за статусом сессии
    if (status === "loading") {
      return; // Ничего не делаем, пока сессия загружается
    }

    if (session?.user?.role !== "ADMIN") {
      router.push("/"); // Используем router.push для перенаправления на клиенте
    }
  }, [session, status, router]);

  useEffect(() => {
    // Этот эффект будет загружать скидки, только если пользователь админ
    if (session?.user?.role === "ADMIN") {
      fetchDiscounts();
    }
  }, [session]); // <-- Зависимость от сессии

  if (status === "loading" || session?.user?.role !== "ADMIN") {
    return <div className="text-center py-12">Loading...</div>;
  }

  const fetchDiscounts = async () => {
    try {
      const response = await fetch("/api/discounts");
      if (response.ok) {
        const data = await response.json();
        setDiscounts(data);
      }
    } catch (error) {
      console.error("Failed to fetch discounts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const url = editingId ? `/api/discounts/${editingId}` : "/api/discounts";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          value: parseFloat(formData.value),
          expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : null,
        }),
      });

      if (response.ok) {
        await fetchDiscounts();
        setDialogOpen(false);
        resetForm();
      }
    } catch (error) {
      console.error("Failed to save discount:", error);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const response = await fetch(`/api/discounts/${deleteId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchDiscounts();
        setDeleteDialogOpen(false);
        setDeleteId(null);
      }
    } catch (error) {
      console.error("Failed to delete discount:", error);
    }
  };

  const handleEdit = (discount: DiscountCode) => {
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
    { value: "FIXED", label: "Fixed Amount ($)" },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Discounts</h1>
        <Button onClick={handleOpenDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Discount
        </Button>
      </div>

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
                  {discount.type === "PERCENT" ? `${discount.value}%` : `$${discount.value}`}
                </td>
                <td className="px-6 py-4">
                  {discount.expiresAt ? new Date(discount.expiresAt).toLocaleDateString() : "Never"}
                </td>
                <td className="px-6 py-4">
                  <span className={discount.isActive ? "text-green-600" : "text-red-600"}>
                    {discount.isActive ? "Active" : "Inactive"}
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
        onOpenChange={setDialogOpen}
        title={editingId ? "Edit Discount" : "Add Discount"}
        onConfirm={handleSubmit}
        confirmText={editingId ? "Update" : "Create"}
      >
        <div className="space-y-4">
          <Input
            label="Code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            required
          />
          <Select
            label="Type"
            options={discountTypes}
            value={formData.type}
            onChange={(e) =>
              setFormData({ ...formData, type: e.target.value as "PERCENT" | "FIXED" })
            }
            required
          />
          <Input
            label="Value"
            type="number"
            step="0.01"
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            required
          />
          <Input
            label="Expires At"
            type="date"
            value={formData.expiresAt}
            onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
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
        onOpenChange={setDeleteDialogOpen}
        title="Delete Discount"
        description="Are you sure you want to delete this discount code? This action cannot be undone."
        onConfirm={handleDelete}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
      />
    </div>
  );
}
