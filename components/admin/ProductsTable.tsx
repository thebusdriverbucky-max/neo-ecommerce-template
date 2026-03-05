// components/admin/ProductsTable.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { Trash2, Edit2 } from "lucide-react";
import { formatPrice } from "@/lib/utils";

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

interface ProductsTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
}

export default function ProductsTable({
  products,
  onEdit,
  onDelete,
}: ProductsTableProps) {
  return (
    <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full">
        <thead className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="text-left px-6 py-3 font-semibold">Name</th>
            <th className="text-left px-6 py-3 font-semibold">Category</th>
            <th className="text-left px-6 py-3 font-semibold">Price</th>
            <th className="text-left px-6 py-3 font-semibold">Stock</th>
            <th className="text-left px-6 py-3 font-semibold">Featured</th>
            <th className="text-left px-6 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr
              key={product.id}
              className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  {product.name.length > 45 ? `${product.name.substring(0, 45)}...` : product.name}
                  {product.isArchived && (
                    <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded-full">
                      Archived
                    </span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4">{product.category}</td>
              <td className="px-6 py-4">{formatPrice(product.price)}</td>
              <td className="px-6 py-4">{product.stock}</td>
              <td className="px-6 py-4">
                <span
                  className={
                    product.featured ? "text-green-600" : "text-gray-400"
                  }
                >
                  {product.featured ? "Yes" : "No"}
                </span>
              </td>
              <td className="px-6 py-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(product)}
                  className="gap-2"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(product.id)}
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
  );
}
