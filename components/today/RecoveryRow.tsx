// RecoveryRow (Sprint v0.8) — 3 small glass-cards (HRV / Sleep / Recovery)
// for /today's morning snapshot. Mobile: 3-column compact, desktop: same 3-col
// but larger.
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Trend vs baseline (positive = improving). */
  delta?: number;
  status?: "ok" | "warn" | "crit";
}

function MetricCard({
  label,
  value,
  unit,
  delta,
  status = "ok",
}: MetricCardProps) {
  const statusColor = {
    ok: "text-[var(--text-primary)]",
    warn: "text-[var(--warning)]",
    crit: "text-[var(--destructive)]",
  }[status];

  return (
    <div className="glass-card p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={cn("text-xl font-semibold tabular-nums", statusColor)}
        >
          {value}
        </span>
        {unit && (
          <span className="text-xs text-[var(--text-tertiary)]">{unit}</span>
        )}
      </div>
      {delta !== undefined && (
        <div
          className={cn(
            "mt-1 text-xs tabular-nums",
            delta >= 0 ? "text-[var(--success)]" : "text-[var(--warning)]",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {delta}
        </div>
      )}
    </div>
  );
}

export function RecoveryRow({
  hrv,
  sleep,
  recovery,
}: {
  hrv?: { value: number; delta?: number; status: "ok" | "warn" | "crit" };
  sleep?: { score: number; durationH?: number };
  recovery?: { score: number; band?: "ok" | "warn" | "crit" };
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <MetricCard
        label="HRV"
        value={hrv?.value ?? "—"}
        unit="ms"
        delta={hrv?.delta}
        status={hrv?.status}
      />
      <MetricCard
        label="Schlaf"
        value={sleep?.score ?? "—"}
        unit={sleep?.durationH != null ? `· ${sleep.durationH}h` : undefined}
      />
      <MetricCard
        label="Recovery"
        value={recovery?.score ?? "—"}
        unit="%"
        status={recovery?.band}
      />
    </div>
  );
}
