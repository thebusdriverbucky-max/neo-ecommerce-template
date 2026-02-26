// components/ui/Input.tsx

import { cn } from "@/lib/utils";
import React from "react";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
  helperText?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, label, helperText, id, ...props }, ref) => {
    const inputId = id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium mb-2">
            {label}
            {props.required && <span className="text-red-600">*</span>}
          </label>
        )}
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-0 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-600 dark:focus:ring-blue-400",
            error && "border-red-600 focus:ring-red-600 dark:border-red-600 dark:focus:ring-red-600",
            className
          )}
          ref={ref}
          id={inputId}
          {...props}
        />
        {error && (
          <p className="text-xs text-red-600 mt-1">{error}</p>
        )}
        {helperText && !error && (
          <p className="text-xs text-gray-500 mt-1">{helperText}</p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
