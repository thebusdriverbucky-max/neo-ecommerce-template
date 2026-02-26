// components/ui/Select.tsx

import { cn } from "@/lib/utils";
import React from "react";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label?: string;
  options: Array<{ value: string; label: string }>;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, label, options, id, ...props }, ref) => {
    const selectId = id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium mb-2">
            {label}
            {props.required && <span className="text-red-600">*</span>}
          </label>
        )}
        <select
          className={cn(
            "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-0 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-600 dark:focus:ring-blue-400",
            error && "border-red-600 focus:ring-red-600",
            className
          )}
          ref={ref}
          id={selectId}
          {...props}
        >
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="text-xs text-red-600 mt-1">{error}</p>
        )}
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
