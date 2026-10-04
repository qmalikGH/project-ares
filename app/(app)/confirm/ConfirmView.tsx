"use client";

// Bulk session confirmation — Sprint 3.0.
//
// The athlete trains and never opens the completion wizard. The nightly Garmin
// import fills in everything the watch measured; this screen collects the two
// things it cannot know (effort and shin pain) plus, for strength, whether the
// session ran as written. A week in under a minute, retroactively.
//
// Sprint 3.2a — actual, not plan:
//   - a run or strength session the watch did not link offers the Garmin
//     activity recorded that day (±1). One tap imports the real recording.
//     Without one, minutes can be typed in; left empty, the plan only stands
//     in as an estimate and is labelled as such.
//   - strength asks for the top set of each training-max lift. Only that can
//     move a training max; "the rest as prescribed" records volume and is off
//     by default — it used to be on, and an untouched card claimed every set.
//   - both also for strength the watch completed, which used to get no sets.

import { useCallback, useEffect, useState } from "react";

import { NumberSelector, SHIN_THRESHOLDS } from "@/components/ui/NumberSelector";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SESSION_LABEL } from "@/components/training/shared";
import { getSessionColor } from "@/lib/ui/session-colors";
import { cn } from "@/lib/utils";

interface PrescribedExercise {
  name: string;
  sets: number;
  reps: number | string;
  loadAbs: number | null;
  willLog: boolean;
  isTm: boolean;
}

interface OpenSession {
  id: string;
  date: string;
  type: string;
  cohort: "planned" | "garmin_auto";
  discipline: "run" | "strength" | "other";
  plannedDurationMin: number | null;
  garmin: {
    activityId: string | null;
    durationSec: number | null;
    distanceM: number | null;
    averageHr: number | null;
  } | null;
  prescribed: { exercises: PrescribedExercise[] } | null;
}

interface Candidate {
  activityId: number;
  activityName: string;
  date: string;
  dayOffset: number;
  durationMin: number;
  distanceKm: number | null;
  averageHr: number | null;
}

interface TopSetDraft {
  kg: string;
  reps: string;
}

interface Draft {
  rpe: number | null;
  shin: number | null;
  asPrescribed: boolean;
  skip: boolean;
  garminActivityId: number | null;
  minutes: string;
  topSets: Record<string, TopSetDraft>;
}

interface ConfirmResponse {
  attested: number;
  skipped: number;
  failed: number;
  results: Array<{ outcome: string; loadEstimated?: boolean }>;
  regenerate: { gate?: string; gateReason?: string; layoffActive?: boolean; regenerated?: number } | null;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const EMPTY_DRAFT: Draft = {
  rpe: null,
  shin: null,
  asPrescribed: false,
  skip: false,
  garminActivityId: null,
  minutes: "",
  topSets: {},
};

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

function summaryLine(s: OpenSession): string {
  if (s.garmin) {
    const parts: string[] = [];
    if (s.garmin.distanceM) parts.push(`${(s.garmin.distanceM / 1000).toFixed(2)} km`);
    if (s.garmin.durationSec) parts.push(`${Math.round(s.garmin.durationSec / 60)} min`);
    if (s.garmin.averageHr) parts.push(`⌀ ${s.garmin.averageHr} bpm`);
    return parts.join(" · ") || "von der Uhr importiert";
  }
  const parts: string[] = [];
  if (s.plannedDurationMin) parts.push(`geplant ${s.plannedDurationMin} min`);
  if (s.prescribed) parts.push(`${s.prescribed.exercises.length} Übungen`);
  return parts.join(" · ") || "keine Details";
}

function candidateLabel(c: Candidate): string {
  const parts = [`${c.durationMin} min`];
  if (c.distanceKm) parts.push(`${c.distanceKm.toFixed(2)} km`);
  if (c.averageHr) parts.push(`⌀ ${c.averageHr}`);
  return `${formatDate(c.date)} · ${parts.join(" · ")}`;
}

/** Positive integer from a text field, or null. */
function parseIntField(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Positive decimal (comma or dot) from a text field, or null. */
function parseKgField(v: string): number | null {
  const n = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm";

export default function ConfirmView() {
  const [sessions, setSessions] = useState<OpenSession[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({});
  const [candidatesState, setCandidatesState] = useState<"loading" | "ok" | "unavailable">("loading");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfirmResponse | null>(null);

  const loadCandidates = useCallback(async () => {
    setCandidatesState("loading");
    try {
      const r = await fetch("/api/sessions/open/candidates?days=7");
      const d = (await r.json()) as { status: string; candidates: Record<string, Candidate[]> };
      setCandidates(d.candidates ?? {});
      setCandidatesState(d.status === "ok" ? "ok" : "unavailable");
    } catch {
      setCandidates({});
      setCandidatesState("unavailable");
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/sessions/open?days=7");
      const d = (await r.json()) as { sessions: OpenSession[] };
      setSessions(d.sessions);
      setDrafts(Object.fromEntries(d.sessions.map((s) => [s.id, { ...EMPTY_DRAFT }])));
      if (d.sessions.length > 0) setExpanded(d.sessions[0].id);
      // After the cards are on screen — this one needs a Garmin login.
      if (d.sessions.some((s) => s.cohort === "planned")) void loadCandidates();
      else setCandidatesState("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    }
  }, [loadCandidates]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const patchTopSet = (id: string, exercise: string, p: Partial<TopSetDraft>) =>
    setDrafts((prev) => {
      const cur = prev[id];
      const ts = cur.topSets[exercise] ?? { kg: "", reps: "" };
      return { ...prev, [id]: { ...cur, topSets: { ...cur.topSets, [exercise]: { ...ts, ...p } } } };
    });

  /** Activities picked on OTHER cards — one recording backs one session. */
  const takenElsewhere = (id: string) =>
    new Set(
      Object.entries(drafts)
        .filter(([k, d]) => k !== id && !d.skip && d.garminActivityId != null)
        .map(([, d]) => d.garminActivityId as number),
    );

  const ready = (s: OpenSession) => {
    const d = drafts[s.id];
    if (!d) return false;
    return d.skip || (d.rpe !== null && d.shin !== null);
  };

  const pending = (sessions ?? []).filter((s) => {
    const d = drafts[s.id];
    return d && (d.skip || d.rpe !== null || d.shin !== null);
  });
  const canSubmit = pending.length > 0 && pending.every(ready);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const items = pending.map((s) => {
        const d = drafts[s.id];
        if (d.skip) return { workoutId: s.id, action: "skip" as const };

        const topSets = Object.entries(d.topSets)
          .map(([exercise, t]) => ({ exercise, weightKg: parseKgField(t.kg), reps: parseIntField(t.reps) }))
          .filter((t): t is { exercise: string; weightKg: number; reps: number } =>
            t.weightKg != null && t.reps != null,
          );
        const minutes = parseIntField(d.minutes);

        return {
          workoutId: s.id,
          action: "attest" as const,
          rpe: d.rpe as number,
          shinPainNrs: d.shin as number,
          ...(d.garminActivityId != null ? { garminActivityId: d.garminActivityId } : {}),
          ...(d.garminActivityId == null && minutes != null && s.cohort === "planned"
            ? { durationActualMin: minutes }
            : {}),
          ...(s.discipline === "strength"
            ? { asPrescribed: d.asPrescribed, ...(topSets.length > 0 ? { topSets } : {}) }
            : {}),
        };
      });
      const r = await fetch("/api/sessions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = (await r.json()) as ConfirmResponse & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Speichern fehlgeschlagen");
      setResult(d);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  if (error && !sessions) {
    return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  }
  if (!sessions) {
    return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;
  }

  const estimatedCount = result?.results.filter((r) => r.loadEstimated).length ?? 0;
  const takenCount = result?.results.filter((r) => r.outcome === "activity_taken").length ?? 0;

  return (
    <div className="flex w-full flex-col gap-5 px-6" style={{ paddingTop: 24, paddingBottom: 120 }}>
      <div>
        <h1 className="text-xl font-semibold">Einheiten bestätigen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Was die Uhr aufgezeichnet hat, ist schon da. Fehlen: wie anstrengend es war, was das
          Schienbein gesagt hat — und bei Kraft dein schwerster Satz.
        </p>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">
            {result.attested} bestätigt
            {result.skipped > 0 ? `, ${result.skipped} als ausgefallen markiert` : ""}
            {result.failed > 0 ? `, ${result.failed} nicht möglich` : ""}
          </p>
          {estimatedCount > 0 && (
            <p className="mt-1 text-emerald-200/80">
              {estimatedCount} ohne Aufzeichnung — die Dauer ist als Schätzung aus dem Plan geführt.
            </p>
          )}
          {takenCount > 0 && (
            <p className="mt-1 text-amber-300">
              {takenCount}× war die gewählte Garmin-Aktivität schon einer anderen Einheit zugeordnet.
            </p>
          )}
          {/* The plan may have just changed underneath him. Say so, in the
              engine's own words, rather than letting him discover it later. */}
          {result.regenerate?.gateReason && (
            <p className="mt-2 text-emerald-200/80">
              Plan neu berechnet ({result.regenerate.regenerated} Wochen) — Bremse:{" "}
              <span className="font-medium">{result.regenerate.gate}</span> ·{" "}
              {result.regenerate.gateReason}
            </p>
          )}
        </div>
      )}

      {sessions.length === 0 && (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
          Nichts offen. Alle Einheiten der letzten 7 Tage sind bestätigt.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {sessions.map((s) => {
          const d = drafts[s.id];
          const color = getSessionColor(s.type);
          const isOpen = expanded === s.id;
          const cands = s.cohort === "planned" ? candidates[s.id] ?? [] : [];
          const taken = isOpen ? takenElsewhere(s.id) : new Set<number>();
          const tmLifts = s.prescribed?.exercises.filter((ex) => ex.isTm) ?? [];
          const restLoggable = s.prescribed?.exercises.filter((ex) => !ex.isTm) ?? [];
          return (
            <div
              key={s.id}
              className={cn(
                "rounded-lg border bg-white/[0.02] transition-colors",
                d?.skip
                  ? "border-[var(--border-subtle)] opacity-50"
                  : ready(s)
                    ? "border-emerald-500/40"
                    : "border-[var(--border-subtle)]",
              )}
              style={{ borderLeft: `3px solid ${color.color}` }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="label">{formatDate(s.date)}</span>
                    <span className="text-sm font-medium" style={{ color: color.color }}>
                      {SESSION_LABEL[s.type] ?? s.type}
                    </span>
                    {(s.cohort === "garmin_auto" || d?.garminActivityId != null) && (
                      <span className="chip">Uhr</span>
                    )}
                  </div>
                  <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", d?.skip && "line-through")}>
                    {summaryLine(s)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {d?.skip ? "ausgefallen" : ready(s) ? "✓" : isOpen ? "–" : "+"}
                </span>
              </button>

              {isOpen && !d?.skip && (
                <div className="flex flex-col gap-5 border-t border-[var(--border-subtle)] px-4 py-4">
                  {/* Sprint 3.2a: the real recording, if Garmin has one. */}
                  {s.cohort === "planned" && (s.discipline === "run" || s.discipline === "strength") && (
                    <div>
                      <p className="label mb-2">Aufzeichnung</p>
                      {candidatesState === "loading" && (
                        <p className="text-xs text-muted-foreground">Suche Garmin-Aktivitäten…</p>
                      )}
                      {candidatesState === "unavailable" && (
                        <p className="text-xs text-muted-foreground">Garmin gerade nicht erreichbar.</p>
                      )}
                      {cands.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {cands.map((c) => {
                            const selected = d?.garminActivityId === c.activityId;
                            const blocked = taken.has(c.activityId);
                            return (
                              <button
                                key={c.activityId}
                                type="button"
                                disabled={blocked}
                                aria-pressed={selected}
                                onClick={() =>
                                  patch(s.id, { garminActivityId: selected ? null : c.activityId })
                                }
                                className={cn(
                                  "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                                  selected
                                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                    : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-secondary)]",
                                  blocked && "opacity-40",
                                )}
                              >
                                {selected ? "✓ " : ""}
                                {c.activityName} · {candidateLabel(c)}
                                {blocked && " · schon zugeordnet"}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {candidatesState === "ok" && cands.length === 0 && (
                        <p className="text-xs text-muted-foreground">Keine Garmin-Aktivität an diesem Tag.</p>
                      )}
                      {d?.garminActivityId == null && (
                        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="shrink-0">Minuten</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={600}
                            value={d?.minutes ?? ""}
                            onChange={(e) => patch(s.id, { minutes: e.target.value })}
                            placeholder={s.plannedDurationMin ? String(s.plannedDurationMin) : "—"}
                            className={cn(inputCls, "max-w-24")}
                          />
                          {!parseIntField(d?.minutes ?? "") && (
                            <span>leer = Schätzung aus dem Plan</span>
                          )}
                        </label>
                      )}
                    </div>
                  )}

                  <NumberSelector
                    label="Anstrengung (RPE)"
                    hint="1 = locker · 10 = maximal"
                    value={d?.rpe ?? null}
                    onChange={(v) => patch(s.id, { rpe: v })}
                    highIsGood={false}
                  />
                  <NumberSelector
                    label="Schienbein danach (NRS)"
                    hint="0 = keine · ≤3 grün · 4–5 halten · >5 zurücknehmen"
                    value={d?.shin ?? null}
                    onChange={(v) => patch(s.id, { shin: v })}
                    highIsGood={false}
                    min={0}
                    thresholds={SHIN_THRESHOLDS}
                  />

                  {s.discipline === "strength" && s.prescribed && (
                    <div className="flex flex-col gap-3">
                      {tmLifts.length > 0 && (
                        <div>
                          <p className="label mb-1">Schwerster Satz</p>
                          <p className="mb-2 text-xs text-muted-foreground">
                            Was du wirklich gehoben hast. Deine RPE oben gilt für diesen Satz — nur
                            darüber passen sich die Trainingsmaxima an.
                          </p>
                          <div className="flex flex-col gap-2">
                            {tmLifts.map((ex) => {
                              const t = d?.topSets[ex.name] ?? { kg: "", reps: "" };
                              return (
                                <div key={ex.name} className="grid grid-cols-[1fr_5rem_4rem] items-center gap-2">
                                  <span className="truncate text-sm text-[var(--text-secondary)]">{ex.name}</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    aria-label={`${ex.name} kg`}
                                    value={t.kg}
                                    onChange={(e) => patchTopSet(s.id, ex.name, { kg: e.target.value })}
                                    placeholder={ex.loadAbs ? `${ex.loadAbs} kg` : "kg"}
                                    className={inputCls}
                                  />
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={50}
                                    aria-label={`${ex.name} Wiederholungen`}
                                    value={t.reps}
                                    onChange={(e) => patchTopSet(s.id, ex.name, { reps: e.target.value })}
                                    placeholder={`× ${ex.reps}`}
                                    className={inputCls}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div>
                        <button
                          type="button"
                          aria-pressed={d?.asPrescribed ?? false}
                          onClick={() => patch(s.id, { asPrescribed: !d?.asPrescribed })}
                          className={cn(
                            "mb-2 w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                            d?.asPrescribed
                              ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                              : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-tertiary)]",
                          )}
                        >
                          {d?.asPrescribed ? "✓ Rest wie vorgegeben gemacht" : "Rest wie vorgegeben gemacht?"}
                        </button>
                        <ul className="flex flex-col gap-1">
                          {restLoggable.map((ex) => (
                            <li
                              key={ex.name}
                              className={cn(
                                "flex items-baseline justify-between text-xs",
                                ex.willLog ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
                              )}
                            >
                              <span className={cn(!ex.willLog && "opacity-60")}>{ex.name}</span>
                              <span className="num">
                                {ex.sets}×{ex.reps}
                                {ex.loadAbs ? ` @ ${ex.loadAbs} kg` : ""}
                                {/* Honesty: these are recorded as prescribed, but
                                    they carry no usable 1RM signal, so they never
                                    reach the training-max evaluation. */}
                                {!ex.willLog && <span className="ml-1 opacity-60">· nicht protokolliert</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {s.cohort === "planned" && (
                    <button
                      type="button"
                      onClick={() => patch(s.id, { skip: true, garminActivityId: null })}
                      className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-[var(--text-secondary)]"
                    >
                      War ausgefallen
                    </button>
                  )}
                </div>
              )}

              {d?.skip && (
                <div className="border-t border-[var(--border-subtle)] px-4 py-2">
                  <button
                    type="button"
                    onClick={() => patch(s.id, { skip: false })}
                    className="text-xs text-muted-foreground underline underline-offset-2"
                  >
                    doch gemacht
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {sessions.length > 0 && (
        <PrimaryButton onClick={submit} disabled={!canSubmit || busy}>
          {busy ? "Speichere…" : `Bestätigen (${pending.length})`}
        </PrimaryButton>
      )}
    </div>
  );
}
