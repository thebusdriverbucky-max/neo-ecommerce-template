// components/ui/Textarea.tsx

import { cn } from "@/lib/utils";
import React from "react";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, label, id, ...props }, ref) => {
    const textareaId = id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium mb-2">
            {label}
            {props.required && <span className="text-red-600">*</span>}
          </label>
        )}
        <textarea
          className={cn(
            "flex min-h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-0 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-600 dark:focus:ring-blue-400",
            error && "border-red-600 focus:ring-red-600",
            className
          )}
          ref={ref}
          id={textareaId}
          {...props}
        />
        {error && (
          <p className="text-xs text-red-600 mt-1">{error}</p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
