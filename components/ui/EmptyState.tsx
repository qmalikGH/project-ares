// EmptyState (Sprint v0.8) — uniform "nothing here yet" container.
// Use on /history when no workouts have been logged, on /coach when there's
// no conversation yet, etc.
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  /** Optional CTA — typically a <PrimaryButton> or a Link. */
  action?: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col items-center gap-3 p-8 text-center">
      {Icon && <Icon className="h-8 w-8 text-[var(--text-tertiary)]" />}
      <h3 className="text-base font-medium text-[var(--text-primary)]">
        {title}
      </h3>
      {description && (
        <p className="max-w-sm text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      )}
      {action && <div className="mt-2 w-full max-w-xs">{action}</div>}
    </div>
  );
}
