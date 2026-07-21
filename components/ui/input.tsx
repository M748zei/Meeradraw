import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-12 w-full rounded-2xl border border-cream-200 bg-white px-4 text-sm text-ink shadow-soft placeholder:text-ink-muted/60 focus:border-sky-300 focus:outline-none focus:ring-4 focus:ring-sky-100",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
