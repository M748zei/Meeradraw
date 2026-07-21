import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[160px] w-full rounded-3xl border border-cream-200 bg-white px-5 py-4 text-base text-ink shadow-soft placeholder:text-ink-muted/60 focus:border-sky-300 focus:outline-none focus:ring-4 focus:ring-sky-100 resize-none",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
