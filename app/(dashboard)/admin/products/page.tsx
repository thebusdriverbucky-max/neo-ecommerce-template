// app/(dashboard)/admin/products/page.tsx

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Plus } from "lucide-react";
import ProductsTable from "@/components/admin/ProductsTable";
import Pagination from "@/components/admin/Pagination";
import { ProductImageUpload } from "@/components/admin/product-image-upload";
import { productSchema, productImageSchema } from "@/lib/validations";
import { productFieldErrors } from "@/lib/product-feedback";
import { saveProductDraft } from "@/lib/product-upload";
import { getSettings, type StoreSettingsData } from "@/app/actions/settings";
import { DEFAULT_CATEGORIES } from "@/lib/constants";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number | string;
  category: string;
  stock: number;
  image: string;
  images: string[];
  featured: boolean;
  isArchived: boolean;
  currency: string;
}

const PRODUCTS_PER_PAGE = 20;

export default function AdminProductsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const [deleteError, setDeleteError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [enabledCategories, setEnabledCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [listError, setListError] = useState("");
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

  // Save form data to localStorage whenever it changes
  useEffect(() => {
    if (dialogOpen) {
      try { saveProductDraft(localStorage, { data: formData, editingId }); } catch { /* storage unavailable */ }
    }
  }, [formData, editingId, dialogOpen]);

  const isAdmin = session?.user?.role === "ADMIN";

  const fetchProducts = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ all: "true", page: String(page), pageSize: String(PRODUCTS_PER_PAGE) });
      if (searchQuery) params.set("search", searchQuery);
      const response = await fetch(`/api/products?${params}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !Array.isArray(data.products)) {
        throw new Error(data?.error || "Invalid product list");
      }
      const lastPage = Math.max(1, Math.ceil(data.total / PRODUCTS_PER_PAGE));
      if (data.products.length === 0 && data.total > 0 && page > lastPage) {
        setPage(lastPage);
        return;
      }
      setProducts(data.products);
      setTotal(data.total);
      setListError("");
    } catch {
      setListError("Could not load products. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, searchQuery]);

  useEffect(() => {
    if (isAdmin) fetchProducts();
  }, [isAdmin, fetchProducts]);

  useEffect(() => {
    if (isAdmin) fetchSettings();
  }, [isAdmin]);

  const fetchSettings = async () => {
    try {
      const res = await getSettings();
      const data = res.data as unknown as StoreSettingsData;
      if (res.success && data?.enabledCategories && data.enabledCategories.length > 0) {
        setEnabledCategories(data.enabledCategories);
      }
    } catch { /* Keep the built-in categories if settings are temporarily unavailable. */ }
  };

  const handleSubmit = async (restore = false) => {
    if (savingRef.current) return;
    setFormError("");
    setFieldErrors({});
    if (newImageUrl.trim()) {
      setFormError("Add the pending additional image URL using Add by URL, or clear it before saving.");
      return;
    }
    const parsed = productSchema.safeParse({ ...formData, ...(restore ? { isArchived: false } : {}) });
    if (!parsed.success) {
      setFieldErrors(productFieldErrors(parsed.error.issues));
      setFormError("Please correct the highlighted fields.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/products/${editingId}` : "/api/products", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(result?.error || `Could not save product (HTTP ${response.status}). Please try again.`);
        setFieldErrors(result?.fieldErrors || {});
        return;
      }
      setNotice(restore ? "Product restored." : editingId ? "Product updated." : "Product created.");
      setDialogOpen(false);
      resetForm();
      await fetchProducts();
    } catch {
      setFormError("Could not reach the server. Your form is still here; check your connection and retry.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Hard delete and archive share one request/feedback path.
  const removeProduct = async (hard: boolean) => {
    if (!deleteId || removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/products/${deleteId}${hard ? "?hard=true" : ""}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setDeleteError(
          result?.error || `Could not ${hard ? "delete" : "archive"} the product (HTTP ${response.status}). Please try again.`
        );
        return;
      }
      setNotice(hard ? "Product deleted permanently." : "Product archived. It is hidden from the store and kept in order history.");
      setDeleteDialogOpen(false);
      setDeleteId(null);
      await fetchProducts();
    } catch {
      setDeleteError("Could not reach the server. Check your connection and try again.");
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  };

  const handleDelete = () => removeProduct(true);
  const handleArchive = () => removeProduct(false);

  const handleEdit = (product: Product) => {
    setFieldErrors({});
    setFormError("");
    setNewImageUrl("");
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
    setDeleteError("");
    setNotice("");
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
    setNewImageUrl("");
    try { localStorage.removeItem("admin_product_form_draft"); } catch { /* storage unavailable */ }
  };

  const handleAddImageUrl = () => {
    const parsed = productImageSchema.safeParse(newImageUrl);
    if (!parsed.success) {
      setFieldErrors(previous => ({ ...previous, images: parsed.error.issues[0].message }));
      return;
    }
    setFormData(previous => ({ ...previous, images: [...previous.images, parsed.data].slice(0, 4) }));
    setFieldErrors(previous => ({ ...previous, images: "" }));
    setNewImageUrl("");
  };

  const handleOpenDialog = () => {
    setFieldErrors({});
    setFormError("");
    setNotice("");
    setNewImageUrl("");
    try {
      const saved = localStorage.getItem("admin_product_form_draft");
      if (saved) {
        const { data, editingId: savedId } = JSON.parse(saved);
        if (!data || !Array.isArray(data.images) || !data.images.every((image: unknown) => typeof image === "string") || !["name", "slug", "description", "price", "category", "stock", "image"].every(key => typeof data[key] === "string")) throw new Error("Invalid draft");
        setFormData(data);
        setEditingId(typeof savedId === "string" ? savedId : null);
      } else resetForm();
    } catch { resetForm(); }
    setDialogOpen(true);
  };

  if (sessionStatus !== "loading" && session?.user?.role !== "ADMIN") redirect("/");

  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE));

  if (loading || sessionStatus === "loading") {
    return <div className="text-center py-12">Loading...</div>;
  }

  const categories = Array.from(new Set([...enabledCategories, ...(formData.category ? [formData.category] : [])]))
    .map(cat => ({ value: cat, label: cat }));

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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearchQuery(searchInput.trim());
        }}
        className="mb-6 flex gap-3 items-end"
      >
        <div className="flex-1">
          <Input
            label="Search"
            name="productSearch"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or slug (archived products included)"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {notice && <p role="status" className="mb-4 text-green-700">{notice}</p>}
      {listError && (
        <div role="alert" className="mb-4 flex items-center gap-3 text-red-600">
          <span>{listError}</span>
          <Button variant="outline" size="sm" onClick={() => void fetchProducts()}>
            Retry
          </Button>
        </div>
      )}
      <div className={refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <ProductsTable
          products={products}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
        />
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        disabled={refreshing}
        summary={`${total} products`}
      />

      {/* Add/Edit Modal */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!savingRef.current) setDialogOpen(open);
        }}
        title={editingId ? "Edit Product" : "Add Product"}
        onConfirm={() => handleSubmit()}
        closeOnConfirm={false}
        isLoading={saving}
        confirmText={editingId ? "Update" : "Create"}
        extraAction={
          editingId && formData.isArchived ? (
            <Button variant="outline" disabled={saving} onClick={() => handleSubmit(true)}>
              Restore
            </Button>
          ) : undefined
        }
      >
        {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
        <fieldset disabled={saving} className="space-y-4 max-h-[60vh] overflow-y-auto px-1">
          <Input
            label="Product Name"
            name="name"
            error={fieldErrors.name}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <Input
            label="Slug"
            name="slug"
            error={fieldErrors.slug}
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            required
          />
          <Textarea
            label="Description"
            name="description"
            error={fieldErrors.description}
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Price"
              name="price"
              error={fieldErrors.price}
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
            />
          </div>
          <Select
            label="Category"
            name="category"
            error={fieldErrors.category}
            options={categories}
            value={formData.category}
            onChange={(e) =>
              setFormData({ ...formData, category: e.target.value })
            }
            required
          />
          <Input
            label="Stock"
            name="stock"
            error={fieldErrors.stock}
            type="number"
            value={formData.stock}
            onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
            required
          />

          {/* Main Image */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Main Product Image</label>
            <p className="text-xs text-gray-500">
              Cloudinary uploads are optimized automatically. Any other HTTPS image URL also works; it is
              shown as-is, without optimization.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Main Image URL"
                error={fieldErrors.image}
                type="url"
                value={formData.image}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                required
                className="flex-1"
              />
              <ProductImageUpload disabled={saving} onUpload={url => setFormData(previous => ({ ...previous, image: url }))} />
            </div>
          </div>

          {/* Additional Images */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Additional Images (up to 4)</label>
            {fieldErrors.images && <p role="alert" className="text-sm text-red-600">{fieldErrors.images}</p>}
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
                <div className="space-y-3 pt-2 border-t border-dashed">
                  <div className="space-y-2">
                    <Input
                      placeholder="Paste additional image URL..."
                      type="url"
                      value={newImageUrl}
                      onChange={(e) => setNewImageUrl(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleAddImageUrl}
                      disabled={!newImageUrl}
                      className="w-full gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add by URL
                    </Button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Or upload from device
                      </span>
                    </div>
                  </div>

                  <ProductImageUpload disabled={saving} label="Upload Additional Image" onUpload={url => {
                    setFormData(previous => ({ ...previous, images: [...previous.images, url].slice(0, 4) }));
                  }} />
                </div>
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
        </fieldset>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!removingRef.current) setDeleteDialogOpen(open);
        }}
        title="Delete Product"
        description="Delete this product permanently? This cannot be undone. A product that appears in any order cannot be deleted. Archive it instead: it is hidden from the store and stays in order history."
        onConfirm={handleDelete}
        closeOnConfirm={false}
        isLoading={removing}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
        extraAction={
          <Button variant="outline" disabled={removing} onClick={handleArchive}>
            Archive
          </Button>
        }
      >
        {deleteError && <p role="alert" className="text-sm text-red-600">{deleteError}</p>}
      </Dialog>
    </div>
  );
}
