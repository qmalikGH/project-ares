"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type FormState = {
  primaryType: "5k_time" | "10k_time" | "21k_time";
  currentTime: string;
  targetTime: string;
  targetDate: string;
  vdotInitial: number;
  patellarTendinopathy: "active" | "monitoring" | "resolved" | "none";
  strengthPerWeek: number;
  maxTrainingDays: number;
};

const Q_DEFAULTS: FormState = {
  primaryType: "5k_time",
  currentTime: "24:30",
  targetTime: "22:00",
  targetDate: "2026-09-15",
  vdotInitial: 42,
  patellarTendinopathy: "active",
  strengthPerWeek: 3,
  maxTrainingDays: 6,
};

export default function OnboardingForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(Q_DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReOnboarding, setIsReOnboarding] = useState(false);
  const [preservedVdot, setPreservedVdot] = useState<number | null>(null);

  // Re-onboarding: prefill VDOT from existing effective value (override or
  // initial) so user doesn't lose calibration. Preserves training history —
  // workouts, sensors, conversations stay; old macrocycle is marked abandoned.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusR, settingsR] = await Promise.all([
          fetch("/api/onboarding/status"),
          fetch("/api/settings"),
        ]);
        if (!cancelled && statusR.ok) {
          const s = await statusR.json();
          if (s.onboarded) setIsReOnboarding(true);
        }
        if (!cancelled && settingsR.ok) {
          const data = await settingsR.json();
          const effVdot = data?.vdot?.effective;
          if (typeof effVdot === "number" && effVdot >= 25 && effVdot <= 65) {
            setPreservedVdot(effVdot);
            setForm((prev) => ({ ...prev, vdotInitial: effVdot }));
          }
        }
      } catch {
        /* non-fatal — defaults stay */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const constraints: { type: string; severity: "active" | "monitoring" | "resolved" }[] = [];
      if (form.patellarTendinopathy !== "none") {
        constraints.push({ type: "patellar_tendinopathy", severity: form.patellarTendinopathy });
      }
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryType: form.primaryType,
          currentTime: form.currentTime,
          targetTime: form.targetTime,
          targetDate: form.targetDate,
          modality: "hybrid",
          vdotInitial: form.vdotInitial,
          constraints,
          preferences: {
            strengthPerWeek: form.strengthPerWeek,
            maxTrainingDays: form.maxTrainingDays,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Onboarding failed (${res.status})`);
      }
      router.push("/today");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {isReOnboarding && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm">
          <strong className="font-medium">Re-Onboarding aktiv.</strong>
          <p className="mt-1 text-yellow-800 dark:text-yellow-200">
            Dein bisheriger Plan wird auf <em>abandoned</em> gesetzt — alle Workouts,
            Sensor-Daten, Knee-Scores und Coach-Conversations bleiben erhalten.
            Ein neuer 20-Wochen-Plan startet ab heute.
          </p>
          {preservedVdot !== null && (
            <p className="mt-1 text-xs text-yellow-800 dark:text-yellow-200">
              Effective VDOT wird aus der bisherigen Kalibrierung übernommen:{" "}
              <strong>{preservedVdot}</strong>.
            </p>
          )}
        </div>
      )}

      <Field label="Race-Distanz">
        <select
          value={form.primaryType}
          onChange={(e) => update("primaryType", e.target.value as FormState["primaryType"])}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="5k_time">5K</option>
          <option value="10k_time">10K</option>
          <option value="21k_time">Halbmarathon</option>
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Aktuelle Zeit (mm:ss)">
          <input
            type="text"
            value={form.currentTime}
            placeholder="24:30"
            pattern="^\d{1,2}:\d{2}$"
            onChange={(e) => update("currentTime", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </Field>
        <Field label="Ziel-Zeit (mm:ss)">
          <input
            type="text"
            value={form.targetTime}
            placeholder="22:00"
            pattern="^\d{1,2}:\d{2}$"
            onChange={(e) => update("targetTime", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Ziel-Datum">
          <input
            type="date"
            value={form.targetDate}
            onChange={(e) => update("targetDate", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </Field>
        <Field label="VDOT (initial)" hint="Aus aktuellem 5k geschätzt">
          <input
            type="number"
            min={25}
            max={65}
            step={1}
            value={form.vdotInitial}
            onChange={(e) => update("vdotInitial", Number.parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </Field>
      </div>

      <Field label="Patellatendinopathie" hint="Bestimmt initiale Therapy-Phase + Constraints">
        <select
          value={form.patellarTendinopathy}
          onChange={(e) => update("patellarTendinopathy", e.target.value as FormState["patellarTendinopathy"])}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="active">Aktiv (Schmerz beim Sport)</option>
          <option value="monitoring">Gut, aber unter Beobachtung</option>
          <option value="resolved">Vergangenheit, keine aktuellen Symptome</option>
          <option value="none">Keine</option>
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Strength pro Woche">
          <input
            type="number"
            min={0}
            max={5}
            value={form.strengthPerWeek}
            onChange={(e) => update("strengthPerWeek", Number.parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Max. Trainingstage / Woche">
          <input
            type="number"
            min={3}
            max={7}
            value={form.maxTrainingDays}
            onChange={(e) => update("maxTrainingDays", Number.parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Generiere Macrozyklus…" : "Plan erstellen"}
      </Button>

      <p className="text-xs text-muted-foreground">
        Die Engine generiert deterministisch 5 Blöcke × 4 Wochen = 20 Wochen mit Lauf- und
        Strength-Sessions, VDOT-Pace-Targets, und Knee-aware Constraints.
      </p>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
