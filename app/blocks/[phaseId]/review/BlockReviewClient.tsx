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
