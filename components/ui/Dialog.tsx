// components/ui/Dialog.tsx

"use client";

import React from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  isLoading?: boolean;
  extraAction?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}

const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDangerous = false,
  isLoading = false,
  extraAction,
  size = "md",
}: DialogProps) => {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size={size as any}>
      <div className="space-y-4">
        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {description}
          </p>
        )}
        {children}
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200 dark:border-gray-800">
          {extraAction && <div className="mr-auto">{extraAction}</div>}
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant={isDangerous ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export { Dialog };
