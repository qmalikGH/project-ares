// Skeleton (Sprint v0.8) — animated placeholder block tinted to match
// `--bg-elevated`. Composes well with .glass-card so a loading hero feels
// indistinguishable from the eventual filled state.
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-elevated)]",
        className,
      )}
    />
  );
}

export function SkeletonHeroCard() {
  return (
    <div className="glass-card-hero space-y-4 p-6 sm:p-8">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}

export function SkeletonGlassCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="glass-card space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}
