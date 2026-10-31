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
//
// Sprint 3.3:
//   - a run without a recording needs its real minutes. The run progression
//     reads nothing else, so the field is required and starts empty — no plan
//     number to nod through.
//   - the 3-km test asks for its time (mm:ss).
//
// Sprint 3.3b (#25):
//   - finished cards go out, unfinished ones stay. One card with an empty
//     minutes field used to lock the button for all of them — without saying
//     why — so nothing was confirmed, the layoff detector saw three weeks
//     without training and restarted the comeback ramp.
//   - 14 days instead of 7: after a missed week, real sessions fell out of the
//     window for good.
//   - "Freier Lauf": a run on a day with nothing planned, typed in or picked
//     from the Garmin runs that match no planned session.

import { useCallback, useEffect, useState } from "react";

import { NumberSelector, SHIN_THRESHOLDS } from "@/components/ui/NumberSelector";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SESSION_LABEL } from "@/components/training/shared";
import { getSessionColor } from "@/lib/ui/session-colors";
import { cn } from "@/lib/utils";
import { CONFIRM_WINDOW_DAYS } from "@/lib/garmin/confirm-candidates";

interface PrescribedExercise {
  name: string;
  sets: number;
  reps: number | string;
  loadAbs: number | null;
  willLog: boolean;
  isTm: boolean;
  /** Sprint 3.3: back-off sets after the top sets — same name as their lift. */
  isBackoff?: boolean;
}

interface OpenSession {
  id: string;
  date: string;
  type: string;
  cohort: "planned" | "garmin_auto";
  discipline: "run" | "strength" | "other";
  plannedDurationMin: number | null;
  testDistanceM: number | null;
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

/** Sprint 3.3b: a Garmin run with no planned session to belong to. */
type FreeRunCandidate = Omit<Candidate, "dayOffset">;

interface FreeRunDraft {
  open: boolean;
  date: string;
  minutes: string;
  rpe: number | null;
  shin: number | null;
  garminActivityId: number | null;
}

const EMPTY_FREE_RUN: FreeRunDraft = {
  open: false,
  date: "",
  minutes: "",
  rpe: null,
  shin: null,
  garminActivityId: null,
};

const FREE_RUN_ERRORS: Record<string, string> = {
  planned_session_exists: "An diesem Tag ist ein Easy Run geplant — bitte oben in seiner Karte bestätigen.",
  run_already_recorded: "Für diesen Tag ist schon ein Easy Run erfasst.",
  activity_taken: "Diese Garmin-Aktivität ist schon einer Einheit zugeordnet.",
  date_out_of_window: `Nur heute und die letzten ${CONFIRM_WINDOW_DAYS} Tage.`,
  garmin_import_failed: "Garmin gerade nicht erreichbar — Minuten eintippen geht auch.",
};

interface TopSetDraft {
  kg: string;
  reps: string;
}

interface Draft {
  rpe: number | null;
  shin: number | null;
  asPrescribed: boolean;
  skip: boolean;
  /** Sprint 3.3: the home prevention routine is only ticked off. */
  done: boolean;
  garminActivityId: number | null;
  minutes: string;
  testTime: string;
  topSets: Record<string, TopSetDraft>;
}

interface ConfirmResponse {
  attested: number;
  skipped: number;
  done?: number;
  failed: number;
  results: Array<{ outcome: string; loadEstimated?: boolean }>;
  timeTrials?: Array<{ measured: number; status: string; newVdot: number | null; reason: string }>;
  regenerate: { gate?: string; gateReason?: string; layoffActive?: boolean; regenerated?: number } | null;
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const EMPTY_DRAFT: Draft = {
  rpe: null,
  shin: null,
  asPrescribed: false,
  skip: false,
  done: false,
  garminActivityId: null,
  minutes: "",
  testTime: "",
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

/** "13:45" (or "13.45") → 825 seconds, or null. */
function parseMmSsField(v: string): number | null {
  const m = /^\s*(\d{1,3})[:.](\d{2})\s*$/.exec(v);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && sec >= 60 ? sec : null;
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
  const [freeRuns, setFreeRuns] = useState<FreeRunCandidate[]>([]);
  const [freeRun, setFreeRun] = useState<FreeRunDraft>(EMPTY_FREE_RUN);
  const [freeRunMsg, setFreeRunMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCandidates = useCallback(async () => {
    setCandidatesState("loading");
    try {
      const r = await fetch(`/api/sessions/open/candidates?days=${CONFIRM_WINDOW_DAYS}`);
      const d = (await r.json()) as {
        status: string;
        candidates: Record<string, Candidate[]>;
        freeRuns?: FreeRunCandidate[];
      };
      setCandidates(d.candidates ?? {});
      setFreeRuns(d.freeRuns ?? []);
      setCandidatesState(d.status === "ok" ? "ok" : "unavailable");
    } catch {
      setCandidates({});
      setFreeRuns([]);
      setCandidatesState("unavailable");
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/sessions/open?days=${CONFIRM_WINDOW_DAYS}`);
      const d = (await r.json()) as { sessions: OpenSession[] };
      setSessions(d.sessions);
      // Sprint 3.3b: a card that stayed open keeps what was already typed.
      setDrafts((prev) => Object.fromEntries(d.sessions.map((s) => [s.id, prev[s.id] ?? { ...EMPTY_DRAFT }])));
      if (d.sessions.length > 0) setExpanded((cur) => (cur && d.sessions.some((s) => s.id === cur) ? cur : d.sessions[0].id));
      // After the cards are on screen — this one needs a Garmin login. Always:
      // the free-run suggestions come from it too.
      void loadCandidates();
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

  /** Sprint 3.3: a run no watch recorded is confirmable only with its minutes. */
  const needsMinutes = (s: OpenSession) =>
    s.discipline === "run" && s.cohort === "planned" && drafts[s.id]?.garminActivityId == null;

  /** Sprint 3.3 (A4): no RPE, no shin score — ticked off or missed. */
  const isPrevention = (s: OpenSession) => s.type === "mobility";

  /** What a touched card still needs before it can go out. Empty = ready. */
  const missingFor = (s: OpenSession): string[] => {
    const d = drafts[s.id];
    if (!d) return ["Angaben"];
    if (d.skip) return [];
    if (isPrevention(s)) return d.done ? [] : ["Haken bei „Gemacht“"];
    const missing: string[] = [];
    if (d.rpe === null) missing.push("RPE");
    if (d.shin === null) missing.push("Schienbein");
    if (needsMinutes(s) && parseIntField(d.minutes) == null) missing.push("Minuten");
    if (s.testDistanceM != null && parseMmSsField(d.testTime) == null) missing.push("Testzeit");
    return missing;
  };
  const ready = (s: OpenSession) => missingFor(s).length === 0;

  const pending = (sessions ?? []).filter((s) => {
    const d = drafts[s.id];
    return d && (d.skip || d.done || d.rpe !== null || d.shin !== null);
  });
  // Sprint 3.3b: the finished ones go out; an unfinished card no longer holds
  // the rest hostage — it stays, and says what it needs.
  const readyToSend = pending.filter(ready);
  const incomplete = pending.filter((s) => !ready(s));
  const canSubmit = readyToSend.length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const items = readyToSend.map((s) => {
        const d = drafts[s.id];
        if (d.skip) return { workoutId: s.id, action: "skip" as const };
        if (isPrevention(s)) return { workoutId: s.id, action: "done" as const };

        const topSets = Object.entries(d.topSets)
          .map(([exercise, t]) => ({ exercise, weightKg: parseKgField(t.kg), reps: parseIntField(t.reps) }))
          .filter((t): t is { exercise: string; weightKg: number; reps: number } =>
            t.weightKg != null && t.reps != null,
          );
        const minutes = parseIntField(d.minutes);
        const testSec = s.testDistanceM != null ? parseMmSsField(d.testTime) : null;

        return {
          workoutId: s.id,
          action: "attest" as const,
          rpe: d.rpe as number,
          shinPainNrs: d.shin as number,
          ...(d.garminActivityId != null ? { garminActivityId: d.garminActivityId } : {}),
          ...(d.garminActivityId == null && minutes != null && s.cohort === "planned"
            ? { durationActualMin: minutes }
            : {}),
          ...(testSec != null ? { timeTrialSec: testSec } : {}),
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
            {result.done ? `, ${result.done}× Prävention abgehakt` : ""}
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
          {result.timeTrials?.map((t, i) => (
            <p key={i} className="mt-1 text-emerald-200/80">
              Test: VDOT {t.measured} gemessen
              {t.newVdot != null ? ` — Tempi jetzt auf VDOT ${t.newVdot}` : ""} · {t.reason}
            </p>
          ))}
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
          Nichts offen. Alle Einheiten der letzten {CONFIRM_WINDOW_DAYS} Tage sind bestätigt.
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
                          <span className="shrink-0">
                            {needsMinutes(s) ? "Gelaufene Minuten" : "Minuten"}
                          </span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={600}
                            value={d?.minutes ?? ""}
                            onChange={(e) => patch(s.id, { minutes: e.target.value })}
                            placeholder="—"
                            className={cn(inputCls, "max-w-24")}
                          />
                          {!parseIntField(d?.minutes ?? "") && (
                            <span>
                              {needsMinutes(s)
                                ? "Pflicht — nur echte Minuten zählen für die Steigerung"
                                : "leer = Schätzung aus dem Plan"}
                            </span>
                          )}
                        </label>
                      )}
                    </div>
                  )}

                  {s.testDistanceM != null && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">Zeit für {s.testDistanceM / 1000} km</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={d?.testTime ?? ""}
                        onChange={(e) => patch(s.id, { testTime: e.target.value })}
                        placeholder="mm:ss"
                        aria-label="Testzeit"
                        className={cn(inputCls, "max-w-24")}
                      />
                      {!parseMmSsField(d?.testTime ?? "") && <span>Pflicht, z. B. 14:05</span>}
                    </label>
                  )}

                  {isPrevention(s) ? (
                    // Sprint 3.3 (A4): ticked off, never rated — a shin score from
                    // ten minutes at home is not evidence about the shin under load.
                    <div className="flex flex-col gap-2">
                      <ul className="flex flex-col gap-1">
                        {(s.prescribed?.exercises ?? []).map((ex, i) => (
                          <li key={`${ex.name}-${i}`} className="flex items-baseline justify-between text-xs text-[var(--text-secondary)]">
                            <span>{ex.name}</span>
                            <span className="num">{ex.sets}×{ex.reps}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        aria-pressed={d?.done ?? false}
                        onClick={() => patch(s.id, { done: !d?.done })}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                          d?.done
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-tertiary)]",
                        )}
                      >
                        {d?.done ? "✓ Gemacht" : "Gemacht?"}
                      </button>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}

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
                          {restLoggable.map((ex, i) => (
                            <li
                              key={`${ex.name}-${i}`}
                              className={cn(
                                "flex items-baseline justify-between text-xs",
                                ex.willLog ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
                              )}
                            >
                              <span className={cn(!ex.willLog && "opacity-60")}>
                                {ex.name}
                                {ex.isBackoff ? " (Back-off)" : ""}
                              </span>
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
        <div className="flex flex-col gap-2">
          <PrimaryButton onClick={submit} disabled={!canSubmit || busy}>
            {busy ? "Speichere…" : `Bestätigen (${readyToSend.length})`}
          </PrimaryButton>
          {/* Sprint 3.3b: the button says why — and which cards wait. */}
          {incomplete.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-amber-300">
              {incomplete.map((s) => (
                <li key={s.id}>
                  {SESSION_LABEL[s.type] ?? s.type} {formatDate(s.date)}: {missingFor(s).join(", ")} fehlt
                  {readyToSend.length > 0 ? " — bleibt stehen" : ""}
                </li>
              ))}
            </ul>
          )}
          {pending.length === 0 && (
            <p className="text-xs text-muted-foreground">Karte aufklappen und ausfüllen — oder „War ausgefallen“.</p>
          )}
        </div>
      )}

      <FreeRunSection
        draft={freeRun}
        candidates={freeRuns}
        candidatesState={candidatesState}
        message={freeRunMsg}
        busy={busy}
        onChange={(p) => setFreeRun((cur) => ({ ...cur, ...p }))}
        onSubmit={submitFreeRun}
      />
    </div>
  );

  async function submitFreeRun() {
    setBusy(true);
    setFreeRunMsg(null);
    try {
      const minutes = parseIntField(freeRun.minutes);
      const r = await fetch("/api/sessions/free-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: freeRun.date,
          rpe: freeRun.rpe,
          shinPainNrs: freeRun.shin,
          ...(freeRun.garminActivityId != null
            ? { garminActivityId: freeRun.garminActivityId }
            : { durationActualMin: minutes }),
        }),
      });
      const d = (await r.json()) as { error?: string; durationActualMin?: number };
      if (!r.ok) {
        setFreeRunMsg({ ok: false, text: FREE_RUN_ERRORS[d.error ?? ""] ?? d.error ?? "Speichern fehlgeschlagen" });
        return;
      }
      setFreeRunMsg({ ok: true, text: `Freier Lauf gespeichert (${d.durationActualMin} min). Der Plan ist neu berechnet.` });
      setFreeRun(EMPTY_FREE_RUN);
      await load();
    } catch (e) {
      setFreeRunMsg({ ok: false, text: e instanceof Error ? e.message : "Speichern fehlgeschlagen" });
    } finally {
      setBusy(false);
    }
  }
}

/** Sprint 3.3b (#25 · 9): a run on a day the plan had nothing for. */
function FreeRunSection(props: {
  draft: FreeRunDraft;
  candidates: FreeRunCandidate[];
  candidatesState: "loading" | "ok" | "unavailable";
  message: { ok: boolean; text: string } | null;
  busy: boolean;
  onChange: (p: Partial<FreeRunDraft>) => void;
  onSubmit: () => void;
}) {
  const { draft: d, candidates, candidatesState, message, busy, onChange, onSubmit } = props;
  const fromGarmin = d.garminActivityId != null;
  const canSave =
    /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
    d.rpe !== null &&
    d.shin !== null &&
    (fromGarmin || parseIntField(d.minutes) != null);

  if (!d.open) {
    return (
      <div className="flex flex-col gap-2">
        {message && <p className={cn("text-xs", message.ok ? "text-emerald-300" : "text-amber-300")}>{message.text}</p>}
        <button
          type="button"
          onClick={() => onChange({ open: true })}
          className="self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-[var(--text-secondary)]"
        >
          + Freien Lauf erfassen (an einem Tag ohne Plan)
          {candidates.length > 0 ? ` · ${candidates.length} von der Uhr` : ""}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Freier Lauf</p>
        <button type="button" onClick={() => onChange({ ...EMPTY_FREE_RUN })} className="text-xs text-muted-foreground underline">
          abbrechen
        </button>
      </div>

      {candidatesState === "ok" && candidates.length > 0 && (
        <div>
          <p className="label mb-2">Von der Uhr, ohne geplante Einheit</p>
          <div className="flex flex-col gap-2">
            {candidates.map((c) => {
              const selected = d.garminActivityId === c.activityId;
              return (
                <button
                  key={c.activityId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    onChange(selected ? { garminActivityId: null } : { garminActivityId: c.activityId, date: c.date })
                  }
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selected
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-[var(--border-subtle)] bg-white/[0.04] text-[var(--text-secondary)]",
                  )}
                >
                  {selected ? "✓ " : ""}
                  {c.activityName} · {formatDate(c.date)} · {c.durationMin} min
                  {c.distanceKm ? ` · ${c.distanceKm.toFixed(2)} km` : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <label className="flex flex-col gap-1">
          <span>Datum</span>
          <input
            type="date"
            value={d.date}
            disabled={fromGarmin}
            onChange={(e) => onChange({ date: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Gelaufene Minuten</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={fromGarmin ? "" : d.minutes}
            disabled={fromGarmin}
            placeholder={fromGarmin ? "von der Uhr" : "—"}
            onChange={(e) => onChange({ minutes: e.target.value })}
            className={inputCls}
          />
        </label>
      </div>

      <NumberSelector
        label="Anstrengung (RPE)"
        hint="1 = locker · 10 = maximal"
        value={d.rpe}
        onChange={(v) => onChange({ rpe: v })}
        highIsGood={false}
      />
      <NumberSelector
        label="Schienbein danach (NRS)"
        hint="0 = keine · ≤3 grün · 4–5 halten · >5 zurücknehmen"
        value={d.shin}
        onChange={(v) => onChange({ shin: v })}
        highIsGood={false}
        min={0}
        thresholds={SHIN_THRESHOLDS}
      />

      {message && <p className={cn("text-xs", message.ok ? "text-emerald-300" : "text-amber-300")}>{message.text}</p>}
      <PrimaryButton onClick={onSubmit} disabled={!canSave || busy}>
        {busy ? "Speichere…" : "Freien Lauf speichern"}
      </PrimaryButton>
    </div>
  );
}
