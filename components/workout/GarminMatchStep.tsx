"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface ActivitySummary {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  category: string;
  durationSec: number;
  distanceM: number | null;
  averageHr: number | null;
  maxHr: number | null;
  averagePaceSecPerKm: number | null;
}

type MatchStatus = "AUTO_MATCH" | "PICKER_NEEDED" | "NO_CANDIDATES";

interface MatchResponse {
  status: "ok" | "GARMIN_ERROR";
  match?: {
    status: MatchStatus;
    bestMatch: ActivitySummary | null;
    candidates: ActivitySummary[];
  };
  error?: string;
  hint?: string;
}

export function GarminMatchStep({
  workoutId,
  onSelected,
  onSkip,
}: {
  workoutId: string;
  onSelected: (activityId: number) => void;
  onSkip: () => void;
}) {
  const [data, setData] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/sessions/garmin-candidates?workoutId=${workoutId}`)
      .then((r) => r.json())
      .then((d: MatchResponse) => {
        if (cancelled) return;
        setData(d);
        if (d.match?.status === "AUTO_MATCH" && d.match.bestMatch) {
          setSelectedId(d.match.bestMatch.activityId);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setData({ status: "GARMIN_ERROR", error: e instanceof Error ? e.message : "Failed" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workoutId, reload]);

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Garmin-Activities werden geladen…
      </div>
    );
  }

  if (data?.status === "GARMIN_ERROR" || !data?.match) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          Garmin konnte nicht erreicht werden{data?.error ? `: ${data.error}` : ""}.
        </p>
        <p className="text-sm text-muted-foreground">
          Du kannst die Session manuell abschließen — die App nutzt dann nur deine
          RPE+Knee-Eingabe.
        </p>
        <div className="flex gap-2">
          <Button onClick={onSkip} variant="outline">
            Manuell abschließen
          </Button>
          <Button
            onClick={() => setReload((r) => r + 1)}
            variant="ghost"
            size="sm"
          >
            Nochmal versuchen
          </Button>
        </div>
      </div>
    );
  }

  if (data.match.status === "NO_CANDIDATES") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Keine passende Garmin-Activity heute gefunden. Möglicherweise hat die
          Uhr noch nicht gesynct, oder die Activity hat einen anderen Type.
        </p>
        <div className="flex gap-2">
          <Button onClick={onSkip} variant="outline">
            Manuell abschließen
          </Button>
          <Button
            onClick={() => setReload((r) => r + 1)}
            variant="ghost"
            size="sm"
          >
            Nochmal versuchen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {data.match.status === "AUTO_MATCH"
          ? "Garmin-Activity gefunden:"
          : `${data.match.candidates.length} Activities heute — welche war's?`}
      </p>

      <div className="space-y-2">
        {data.match.candidates.map((c) => (
          <ActivityCard
            key={c.activityId}
            activity={c}
            selected={selectedId === c.activityId}
            onClick={() => setSelectedId(c.activityId)}
          />
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => selectedId && onSelected(selectedId)}
          disabled={!selectedId}
        >
          Diese Activity nutzen
        </Button>
        <Button onClick={onSkip} variant="outline">
          Ohne Garmin abschließen
        </Button>
      </div>
    </div>
  );
}

function ActivityCard({
  activity,
  selected,
  onClick,
}: {
  activity: ActivitySummary;
  selected: boolean;
  onClick: () => void;
}) {
  const time = new Date(activity.startTimeLocal).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const durationMin = Math.round(activity.durationSec / 60);
  const km = activity.distanceM != null ? (activity.distanceM / 1000).toFixed(2) : "—";
  const pace = activity.averagePaceSecPerKm
    ? `${Math.floor(activity.averagePaceSecPerKm / 60)}:${String(activity.averagePaceSecPerKm % 60).padStart(2, "0")}/km`
    : "—";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-md border p-3 transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "hover:border-muted-foreground/30"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-sm">{activity.activityName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{time}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1 tabular-nums">
        {durationMin}min · {km}km · {pace} · HR {activity.averageHr ?? "—"}
      </div>
    </button>
  );
}
