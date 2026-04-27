"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface ReviewResponse {
  status: string;
  blockReviewId?: string;
  decision?: { decision: string; nextPhase?: string | null; extendByWeeks?: number; reduceIntensityFraction?: number; deferByWeeks?: number };
  reviewInput?: {
    performanceMarkerMet: boolean;
    averageACWR: number;
    averageReadiness: number;
    kneeScoreTrend: string;
    missedSessionsCount: number;
    actualTID: { z1: number; z2: number; z3: number };
  };
  aiSummary?: string | null;
  aiCostUsd?: number;
}

interface TestResultResponse {
  status: string;
  achievedVdot?: number;
  newVdot?: number;
  previousVdot?: number;
  targetVdot?: number | null;
  met?: boolean;
  close?: boolean;
  regenerated?: { updatedSessions: number; updatedPlans: number };
  error?: string;
}

const DECISION_LABELS: Record<string, { label: string; color: string }> = {
  PROCEED: { label: "Proceed → nächster Block", color: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  EXTEND_PHASE: { label: "Block verlängern", color: "text-yellow-800 dark:text-yellow-300 bg-yellow-500/10 border-yellow-500/30" },
  ADJUST_PHASE: { label: "Intensität reduzieren", color: "text-orange-800 dark:text-orange-300 bg-orange-500/10 border-orange-500/30" },
  DEFER: { label: "Block verschieben", color: "text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/30" },
};

export default function BlockReviewClient({ phaseId }: { phaseId: string }) {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/block-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId }),
      });
      const d = (await res.json()) as ReviewResponse;
      if (!res.ok) throw new Error(d.status ?? `HTTP ${res.status}`);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Block-Review</h1>
          <p className="text-sm text-muted-foreground">Auswertung von 4 Wochen Training</p>
        </div>
        <Link href="/today" className="text-sm text-muted-foreground hover:underline">← zurück</Link>
      </header>

      {loading && !data && <p className="text-muted-foreground">Engine wertet aus…</p>}
      {error && <p className="text-destructive">{error}</p>}

      <TestResultRecorder phaseId={phaseId} onRecorded={generate} />

      {data?.reviewInput && data.decision && (
        <>
          <section className={`rounded-lg border p-5 ${DECISION_LABELS[data.decision.decision]?.color ?? "bg-card"}`}>
            <div className="text-xs uppercase tracking-wide opacity-70">Engine-Entscheidung</div>
            <div className="mt-1 text-xl font-bold">
              {DECISION_LABELS[data.decision.decision]?.label ?? data.decision.decision}
            </div>
            {data.decision.nextPhase && (
              <p className="mt-2 text-sm">Nächste Phase: <span className="font-mono">{data.decision.nextPhase}</span></p>
            )}
          </section>

          {data.aiSummary && (
            <section className="rounded-lg border bg-card p-5 shadow-sm">
              <h2 className="text-sm font-semibold mb-2">Coach-Auswertung</h2>
              <p className="text-sm leading-relaxed whitespace-pre-line">{data.aiSummary}</p>
            </section>
          )}

          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold mb-3">Block-Metriken</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Performance-Ziel</dt>
              <dd className={data.reviewInput.performanceMarkerMet ? "text-emerald-600" : "text-orange-600"}>
                {data.reviewInput.performanceMarkerMet ? "erreicht" : "verfehlt"}
              </dd>
              <dt className="text-muted-foreground">Avg ACWR</dt>
              <dd className="tabular-nums">{data.reviewInput.averageACWR.toFixed(2)}</dd>
              <dt className="text-muted-foreground">Avg Readiness</dt>
              <dd className="tabular-nums">{data.reviewInput.averageReadiness}/100</dd>
              <dt className="text-muted-foreground">Knee-Trend</dt>
              <dd>{data.reviewInput.kneeScoreTrend}</dd>
              <dt className="text-muted-foreground">Missed Sessions</dt>
              <dd className="tabular-nums">{data.reviewInput.missedSessionsCount}</dd>
              <dt className="text-muted-foreground">TID (Z1/Z2/Z3)</dt>
              <dd className="tabular-nums">{data.reviewInput.actualTID.z1}% / {data.reviewInput.actualTID.z2}% / {data.reviewInput.actualTID.z3}%</dd>
            </dl>
          </section>

          <Button onClick={generate} variant="outline" disabled={loading}>
            {loading ? "Lade…" : "Neu auswerten"}
          </Button>
        </>
      )}

      {data?.status && data.status !== "ok" && (
        <p className="text-muted-foreground">Status: {data.status}</p>
      )}
    </div>
  );
}

// ============================================
// Test-Result Recorder
// (Block 1: progressive Long Run mit Threshold-Segment.
//  Block 2-4: 5k Time Trial oder 3k Tempo-Test.)
// ============================================
type TestType = "long_run_progressive_w_threshold" | "time_trial_5k" | "tempo_test_3k";

function TestResultRecorder({
  phaseId,
  onRecorded,
}: {
  phaseId: string;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [testType, setTestType] = useState<TestType>(
    "long_run_progressive_w_threshold",
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResultResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Long-run progressive — split list (default 4 km of threshold segment).
  const [splits, setSplits] = useState<{ pace: string; hr: string }[]>(
    Array.from({ length: 4 }, () => ({ pace: "", hr: "" })),
  );
  // 5k TT / 3k tempo — finish time (mm:ss).
  const [finishTime, setFinishTime] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setSplits(Array.from({ length: 4 }, () => ({ pace: "", hr: "" })));
    setFinishTime("");
    setNotes("");
    setResult(null);
    setErr(null);
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const testDate = new Date().toISOString();
      let body: Record<string, unknown>;
      if (testType === "long_run_progressive_w_threshold") {
        const parsedSplits = splits
          .map((s) => ({
            paceSecPerKm: paceStringToSec(s.pace),
            averageHr: s.hr ? Number.parseInt(s.hr, 10) : null,
          }))
          .filter((s) => s.paceSecPerKm !== null) as {
          paceSecPerKm: number;
          averageHr: number | null;
        }[];
        if (parsedSplits.length < 1) {
          throw new Error("Mind. ein Threshold-Split mit Pace eintragen.");
        }
        body = {
          testType,
          testDate,
          thresholdSplits: parsedSplits,
          notes: notes || undefined,
        };
      } else {
        const sec = paceStringToSec(finishTime);
        if (sec === null) {
          throw new Error("Finish-Zeit als mm:ss eintragen, z.B. 22:00.");
        }
        body = {
          testType,
          testDate,
          finishTimeSec: sec,
          notes: notes || undefined,
        };
      }

      const r = await fetch(`/api/blocks/${phaseId}/test-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as TestResultResponse;
      if (!r.ok) {
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setResult(data);
      onRecorded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Block-Test eintragen</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Block 1: Long Run progressive mit Threshold-Segment · Block 2–4:
              5k Time Trial oder 3k Tempo-Test.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} size="sm">
            Test eintragen
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Block-Test eintragen</h2>
        <button
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          schließen
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Test-Typ</span>
        <select
          value={testType}
          onChange={(e) => setTestType(e.target.value as TestType)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          disabled={busy}
        >
          <option value="long_run_progressive_w_threshold">
            Long Run progressive (Threshold-Segment) — Block 1
          </option>
          <option value="time_trial_5k">5k Time Trial</option>
          <option value="tempo_test_3k">3k Tempo-Test</option>
        </select>
      </label>

      {testType === "long_run_progressive_w_threshold" ? (
        <ProgressiveLongRunForm splits={splits} setSplits={setSplits} disabled={busy} />
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">
            Finish-Zeit ({testType === "time_trial_5k" ? "5k" : "3k"}) · mm:ss
          </span>
          <input
            type="text"
            value={finishTime}
            onChange={(e) => setFinishTime(e.target.value)}
            placeholder={testType === "time_trial_5k" ? "22:00" : "12:30"}
            className="rounded-md border bg-background px-3 py-2 text-sm w-32"
            disabled={busy}
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Notizen (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="z.B. Knie 8/10, Wind, RPE 8"
          disabled={busy}
        />
      </label>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {result && result.status === "ok" && (
        <div
          className={`rounded-md border p-3 text-xs ${
            result.met
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
              : "bg-orange-500/10 border-orange-500/30 text-orange-800 dark:text-orange-300"
          }`}
        >
          <div className="font-semibold">
            VDOT: {result.previousVdot} → {result.newVdot}{" "}
            {typeof result.achievedVdot === "number" && (
              <span className="opacity-70">
                (gemessen {result.achievedVdot.toFixed(1)})
              </span>
            )}
          </div>
          {result.targetVdot != null && (
            <div className="mt-1">
              Ziel: {result.targetVdot} ·{" "}
              {result.met ? "erreicht" : result.close ? "knapp verfehlt" : "verfehlt"}
            </div>
          )}
          {result.regenerated && (
            <div className="mt-1 opacity-80">
              {result.regenerated.updatedSessions} zukünftige Sessions mit neuen Pace-Targets
              aktualisiert.
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={reset} variant="outline" size="sm" disabled={busy}>
          Reset
        </Button>
        <Button onClick={submit} size="sm" disabled={busy}>
          {busy ? "Sende…" : "Speichern & VDOT propagieren"}
        </Button>
      </div>
    </section>
  );
}

function ProgressiveLongRunForm({
  splits,
  setSplits,
  disabled,
}: {
  splits: { pace: string; hr: string }[];
  setSplits: (s: { pace: string; hr: string }[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<{ pace: string; hr: string }>) {
    setSplits(splits.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function add() {
    if (splits.length >= 10) return;
    setSplits([...splits, { pace: "", hr: "" }]);
  }
  function remove(idx: number) {
    if (splits.length <= 1) return;
    setSplits(splits.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Threshold-Segment splits eintragen (Pace pro km, optional HR). Nur die
        Threshold-km, NICHT die Easy-Aufwärm-km.
      </p>
      <div className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 text-[11px] uppercase tracking-wide opacity-70">
        <span>km</span>
        <span>Pace (mm:ss)</span>
        <span>HR (bpm)</span>
        <span></span>
      </div>
      {splits.map((s, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-center"
        >
          <span className="text-sm tabular-nums">#{idx + 1}</span>
          <input
            type="text"
            value={s.pace}
            onChange={(e) => update(idx, { pace: e.target.value })}
            placeholder="5:15"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            disabled={disabled}
          />
          <input
            type="number"
            value={s.hr}
            onChange={(e) => update(idx, { hr: e.target.value })}
            placeholder="170"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            min={60}
            max={220}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => remove(idx)}
            className="text-xs text-muted-foreground hover:text-destructive"
            disabled={disabled || splits.length <= 1}
            aria-label="entfernen"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={disabled || splits.length >= 10}
        className="text-xs text-primary hover:underline"
      >
        + km hinzufügen
      </button>
    </div>
  );
}

function paceStringToSec(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const min = Number.parseInt(m[1], 10);
  const sec = Number.parseInt(m[2], 10);
  if (sec >= 60) return null;
  return min * 60 + sec;
}
