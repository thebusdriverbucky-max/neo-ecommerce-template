// app/(dashboard)/admin/products/page.tsx

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Plus, Upload } from "lucide-react";
import ProductsTable from "@/components/admin/ProductsTable";
import { CldUploadWidget } from "next-cloudinary";
import { getSettings, type StoreSettingsData } from "@/app/actions/settings";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number | string | any;
  category: string;
  stock: number;
  image: string;
  images: string[];
  featured: boolean;
  isArchived: boolean;
  currency: string;
}

export default function AdminProductsPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [enabledCategories, setEnabledCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    price: "",
    category: "",
    stock: "",
    image: "",
    images: [] as string[],
    featured: false,
    isArchived: false,
  });

  if (session?.user?.role !== "ADMIN") {
    redirect("/");
  }

  // Save form data to localStorage whenever it changes
  useEffect(() => {
    if (dialogOpen) {
      localStorage.setItem(
        "admin_product_form_draft",
        JSON.stringify({ data: formData, editingId })
      );
    }
  }, [formData, editingId, dialogOpen]);

  useEffect(() => {
    fetchProducts();
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const res = await getSettings();
    const data = res.data as unknown as StoreSettingsData;
    if (res.success && data?.enabledCategories && data.enabledCategories.length > 0) {
      setEnabledCategories(data.enabledCategories);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch("/api/products?all=true");
      const data = await response.json();
      setProducts(data);
    } catch (error) {
      console.error("Failed to fetch products:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const url = editingId ? `/api/products/${editingId}` : "/api/products";
      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          price: parseFloat(formData.price),
          stock: parseInt(formData.stock),
        }),
      });

      if (response.ok) {
        await fetchProducts();
        setDialogOpen(false);
        resetForm();
        localStorage.removeItem("admin_product_form_draft");
      }
    } catch (error) {
      console.error("Failed to save product:", error);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const response = await fetch(`/api/products/${deleteId}?hard=true`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchProducts();
        setDeleteDialogOpen(false);
        setDeleteId(null);
      }
    } catch (error) {
      console.error("Failed to delete product:", error);
    }
  };

  const handleArchive = async () => {
    if (!deleteId) return;

    try {
      const response = await fetch(`/api/products/${deleteId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchProducts();
        setDeleteDialogOpen(false);
        setDeleteId(null);
      }
    } catch (error) {
      console.error("Failed to archive product:", error);
    }
  };

  const handleRestore = async () => {
    if (!editingId) return;

    try {
      const response = await fetch(`/api/products/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          isArchived: false,
          price: parseFloat(formData.price),
          stock: parseInt(formData.stock),
        }),
      });

      if (response.ok) {
        await fetchProducts();
        setDialogOpen(false);
        resetForm();
        localStorage.removeItem("admin_product_form_draft");
      }
    } catch (error) {
      console.error("Failed to restore product:", error);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingId(product.id);
    setFormData({
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price.toString(),
      category: product.category,
      stock: product.stock.toString(),
      image: product.image,
      images: product.images || [],
      featured: product.featured,
      isArchived: product.isArchived,
    });
    setDialogOpen(true);
  };

  const handleDeleteClick = (id: string) => {
    setDeleteId(id);
    setDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      slug: "",
      description: "",
      price: "",
      category: "",
      stock: "",
      image: "",
      images: [],
      featured: false,
      isArchived: false,
    });
    setEditingId(null);
    localStorage.removeItem("admin_product_form_draft");
  };

  const handleOpenDialog = () => {
    const saved = localStorage.getItem("admin_product_form_draft");
    if (saved) {
      try {
        const { data, editingId: savedId } = JSON.parse(saved);
        setFormData(data);
        setEditingId(savedId);
      } catch (e) {
        resetForm();
      }
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  const categories = enabledCategories.map(cat => ({ value: cat, label: cat }));

  const currencies = [
    { value: "USD", label: "USD ($)" },
    { value: "EUR", label: "EUR (€)" },
    { value: "UAH", label: "UAH (₴)" },
    { value: "RUB", label: "RUB (₽)" },
    { value: "GBP", label: "GBP (£)" },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">
          Product <span className="text-primary">Management</span>
        </h1>
        <Button onClick={handleOpenDialog} className="gap-2">
          <Plus className="w-5 h-5" />
          Add Product
        </Button>
      </div>

      <p className="text-xs text-gray-400 text-center mt-2 mb-3 md:hidden">
        ← Scroll left/right to see all actions →
      </p>

      <ProductsTable
        products={products}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
      />

      {/* Add/Edit Modal */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          // Removed resetForm() to prevent data loss during photo upload
        }}
        title={editingId ? "Edit Product" : "Add Product"}
        onConfirm={handleSubmit}
        confirmText={editingId ? "Update" : "Create"}
        extraAction={
          editingId && formData.isArchived ? (
            <Button variant="outline" onClick={handleRestore}>
              Restore
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1">
          <Input
            label="Product Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            required
          />
          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Price"
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
            />
          </div>
          <Select
            label="Category"
            options={categories}
            value={formData.category}
            onChange={(e) =>
              setFormData({ ...formData, category: e.target.value })
            }
            required
          />
          <Input
            label="Stock"
            type="number"
            value={formData.stock}
            onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
            required
          />

          {/* Main Image */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Main Product Image</label>
            <div className="flex gap-2">
              <Input
                placeholder="Main Image URL"
                type="url"
                value={formData.image}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                required
                className="flex-1"
              />
              <CldUploadWidget
                uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET}
                onSuccess={(result: any) => {
                  if (result.info?.secure_url) {
                    setFormData((prev) => {
                      const newData = { ...prev, image: result.info.secure_url };
                      localStorage.setItem(
                        "admin_product_form_draft",
                        JSON.stringify({ data: newData, editingId })
                      );
                      return newData;
                    });
                  }
                }}
              >
                {({ open }) => (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      localStorage.setItem(
                        "admin_product_form_draft",
                        JSON.stringify({ data: formData, editingId })
                      );
                      open();
                    }}
                    className="gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Upload
                  </Button>
                )}
              </CldUploadWidget>
            </div>
          </div>

          {/* Additional Images */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Additional Images (up to 4)</label>
            <div className="grid grid-cols-1 gap-2">
              {formData.images.map((img, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder={`Image ${index + 1} URL`}
                    type="url"
                    value={img}
                    onChange={(e) => {
                      const newImages = [...formData.images];
                      newImages[index] = e.target.value;
                      setFormData({ ...formData, images: newImages });
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const newImages = formData.images.filter((_, i) => i !== index);
                      setFormData({ ...formData, images: newImages });
                    }}
                    className="text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {formData.images.length < 4 && (
                <CldUploadWidget
                  uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET}
                  onSuccess={(result: any) => {
                    if (result.info?.secure_url) {
                      setFormData((prev) => {
                        const newImages = [...prev.images, result.info.secure_url];
                        const newData = { ...prev, images: newImages };
                        localStorage.setItem(
                          "admin_product_form_draft",
                          JSON.stringify({ data: newData, editingId })
                        );
                        return newData;
                      });
                    }
                  }}
                >
                  {({ open }) => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        localStorage.setItem(
                          "admin_product_form_draft",
                          JSON.stringify({ data: formData, editingId })
                        );
                        open();
                      }}
                      className="gap-2 w-full"
                    >
                      <Plus className="w-4 h-4" />
                      Add Additional Image
                    </Button>
                  )}
                </CldUploadWidget>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.featured}
              onChange={(e) =>
                setFormData({ ...formData, featured: e.target.checked })
              }
              className="rounded"
            />
            <span>Featured Product</span>
          </label>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Product"
        description="Are you sure you want to delete this product? This action cannot be undone. The product will disappear from users' order history and the admin panel. Maybe you want to archive it instead? It won't be displayed in the store but will remain in the history."
        onConfirm={handleDelete}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
        extraAction={
          <Button variant="outline" onClick={handleArchive}>
            Archive
          </Button>
        }
      />
    </div>
  );
}
