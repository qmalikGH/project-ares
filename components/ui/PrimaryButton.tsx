"use client";

// PrimaryButton (Sprint v0.8) — full-width cyan-fill CTA pill with subtle
// glow shadow. The signature visual element of the new look. Used on /today
// for "Session starten", on /day/[date] for "Workout abschließen", etc.
import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

export const PrimaryButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex h-12 w-full items-center justify-center rounded-full",
      "bg-[var(--accent)] text-[#0a0a0b] font-semibold text-sm",
      "transition-all duration-200",
      "hover:bg-[#a5e0fb] active:scale-[0.98]",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "shadow-[0_4px_24px_-4px_rgba(125,211,252,0.4)]",
      className,
    )}
    style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    {...props}
  >
    {children}
  </button>
));
PrimaryButton.displayName = "PrimaryButton";
