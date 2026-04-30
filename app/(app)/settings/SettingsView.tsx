"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/training/shared";

type NotifPrefs = {
  garminFailure: boolean;
  blockReviewDue: boolean;
  timeTrialToday: boolean;
  vdotCalibrated: boolean;
};

type HrZonesPayload =
  | {
      configured: true;
      hrMax: number;
      hrRest: number;
      z1Max: number;
      z2Max: number;
      source: string | null;
      updatedAt: string | null;
    }
  | {
      configured: false;
      hrMax: number | null;
      hrRest: number | null;
      source: string | null;
      updatedAt: string | null;
    };

type SettingsResponse = {
  status: "ok";
  account: { email: string; name: string | null; createdAt: string };
  garmin: {
    hasOverride: boolean;
    usernameDisplay: string | null;
    workoutPushEnabled: boolean;
  };
  aiCoach: {
    enabled: boolean;
    modelOverride: string | null;
    effectiveModel: string;
  };
  vdot: {
    effective: number;
    override: number | null;
    overrideAt: string | null;
    overrideRationale: string | null;
  };
  hrZones: HrZonesPayload;
  notifications: NotifPrefs;
  schedule: {
    forcedRestDays: number[]; // ISO 1=Mon..7=Sun
    preferredLongRunDay: number;
  };
  therapyPhaseOverride:
    | "REACTIVE"
    | "DISREPAIR"
    | "REMODELING"
    | "SPORT_SPECIFIC"
    | null;
};

const AVAILABLE_MODELS = [
  { value: "", label: "Default (env)" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

export default function SettingsView() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      if (r.ok) setData((await r.json()) as SettingsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="mx-auto max-w-3xl px-6 py-8 text-destructive">{error}</p>;
  if (!data) return <p className="mx-auto max-w-3xl px-6 py-8 text-muted-foreground">Lade…</p>;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Konfiguration und Profil.</p>
      </header>

      <AccountSection account={data.account} />
      <GarminSection garmin={data.garmin} onSaved={load} />
      <GarminWorkoutPushSection
        enabled={data.garmin.workoutPushEnabled}
        onSaved={load}
      />
      <HrZonesSection hrZones={data.hrZones} onSaved={load} />
      <TrainingDaysSection schedule={data.schedule} onSaved={load} />
      <KneeStatusSection
        current={data.therapyPhaseOverride}
        onSaved={load}
      />
      <ExerciseMaxSection />
      <AiCoachSection aiCoach={data.aiCoach} onSaved={load} />
      <PerformanceSection vdot={data.vdot} onSaved={load} />
      <NotificationsSection notifications={data.notifications} onSaved={load} />
      <DangerZone />
    </div>
  );
}

// ============================================
// Account
// ============================================
function AccountSection({ account }: { account: SettingsResponse["account"] }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Account</h2>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Email</dt>
        <dd>{account.email}</dd>
        <dt className="text-muted-foreground">Name</dt>
        <dd>{account.name ?? "—"}</dd>
        <dt className="text-muted-foreground">Erstellt</dt>
        <dd>{new Date(account.createdAt).toLocaleDateString("de-DE")}</dd>
      </dl>
    </Card>
  );
}

// ============================================
// Garmin
// ============================================
function GarminSection({
  garmin,
  onSaved,
}: {
  garmin: SettingsResponse["garmin"];
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(garmin.usernameDisplay ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        garminUsernameOverride: username || null,
      };
      if (password) body.garminPasswordOverride = password;
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg("Gespeichert.");
      setPassword("");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Garmin Connect</h2>
      <p className="text-xs text-muted-foreground mb-3">
        {garmin.hasOverride
          ? "Override aktiv — überschreibt die ENV-Credentials."
          : "Kein Override — App nutzt ENV-Credentials."}
      </p>

      <div className="space-y-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Username (Email)</span>
          <input
            type="email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="email@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="(unverändert lassen wenn ok)"
          />
          <span className="text-xs text-muted-foreground">
            Wird im Klartext gespeichert (v0.5). Verschlüsselung kommt v0.6.
          </span>
        </label>
      </div>

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
      <Button onClick={save} disabled={busy} className="mt-4">
        {busy ? "Speichere…" : "Credentials speichern"}
      </Button>
    </Card>
  );
}

// ============================================
// Garmin Workout Push (Sprint v0.9)
// ============================================

interface PushableItem {
  date: string;
  type: string;
  durationMin: number | null;
  pushable: boolean;
  reasonNotPushable: "non_pushable_session" | "missing_hr_target" | null;
  existingWorkoutId: string | null;
  currentStatus: string | null;
}

type PushItemState = "queued" | "skipped" | "syncing" | "synced" | "failed";

interface PushItemUI extends PushableItem {
  state: PushItemState;
  resultError?: string;
}

const SHORT_TYPE: Record<string, string> = {
  easy_run: "Easy Run",
  threshold_run: "Threshold",
  tempo_run: "Tempo",
  long_run: "Long Run",
  vo2max_intervals: "VO2max",
  calibration_run: "Calibration",
  strength_a: "Strength A",
  strength_b: "Strength B",
  strength_c: "Strength C",
  rest: "Rest",
  active_recovery: "Recovery",
  time_trial_5k: "5k Time Trial",
};

function GarminWorkoutPushSection({
  enabled,
  onSaved,
}: {
  enabled: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<PushItemUI[] | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setDoneMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/settings/garmin-push", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDoneMsg(next ? "Push aktiviert." : "Push deaktiviert.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setDoneMsg(null);
    setErr(null);
    setItems(null);
    setProgressMsg(null);

    try {
      // 1. Hole die Liste der pushable Workouts der nächsten 7 Tage.
      const listRes = await fetch("/api/garmin/pushable-workouts");
      if (!listRes.ok) throw new Error(`Liste laden: HTTP ${listRes.status}`);
      const listData = (await listRes.json()) as { items: PushableItem[] };

      const initial: PushItemUI[] = listData.items.map((it) => ({
        ...it,
        state: it.pushable ? "queued" : "skipped",
      }));
      setItems(initial);

      const queue = initial.filter((i) => i.state === "queued");
      if (queue.length === 0) {
        setProgressMsg(null);
        setDoneMsg(
          initial.length === 0
            ? "Keine geplanten Sessions in den nächsten 7 Tagen."
            : `Nichts zu pushen — alle ${initial.length} Sessions sind nicht-pushable (Strength / Rest / Time Trial).`,
        );
        return;
      }

      // 2. Push jeden einzeln, mit Live-Update.
      let synced = 0;
      let failed = 0;
      for (let i = 0; i < queue.length; i++) {
        const w = queue[i];
        setProgressMsg(
          `${i + 1}/${queue.length} · ${SHORT_TYPE[w.type] ?? w.type} (${w.date.slice(5)})`,
        );
        // Mark in-flight
        setItems((prev) =>
          prev
            ? prev.map((p) =>
                p.date === w.date && p.type === w.type ? { ...p, state: "syncing" } : p,
              )
            : prev,
        );

        try {
          const pushRes = await fetch("/api/garmin/push-workout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: w.date, type: w.type }),
          });
          const pushData = (await pushRes.json().catch(() => ({}))) as {
            pushed?: boolean;
            error?: string;
            skipReason?: string;
          };
          if (!pushRes.ok || (!pushData.pushed && !pushData.skipReason)) {
            failed += 1;
            setItems((prev) =>
              prev
                ? prev.map((p) =>
                    p.date === w.date && p.type === w.type
                      ? {
                          ...p,
                          state: "failed",
                          resultError:
                            pushData.error ??
                            `HTTP ${pushRes.status}`,
                        }
                      : p,
                  )
                : prev,
            );
          } else if (pushData.pushed) {
            synced += 1;
            setItems((prev) =>
              prev
                ? prev.map((p) =>
                    p.date === w.date && p.type === w.type ? { ...p, state: "synced" } : p,
                  )
                : prev,
            );
          } else {
            // Server marked as skipped post-hoc (e.g. stripped HR after we listed)
            setItems((prev) =>
              prev
                ? prev.map((p) =>
                    p.date === w.date && p.type === w.type ? { ...p, state: "skipped" } : p,
                  )
                : prev,
            );
          }
        } catch (e) {
          failed += 1;
          setItems((prev) =>
            prev
              ? prev.map((p) =>
                  p.date === w.date && p.type === w.type
                    ? {
                        ...p,
                        state: "failed",
                        resultError:
                          e instanceof Error ? e.message : "Network",
                      }
                    : p,
                )
              : prev,
          );
        }
      }

      setProgressMsg(null);
      const summary: string[] = [];
      summary.push(`${synced} synced`);
      if (failed > 0) summary.push(`${failed} failed`);
      const skippedCount = initial.length - queue.length;
      if (skippedCount > 0) summary.push(`${skippedCount} skipped`);
      setDoneMsg(summary.join(" · "));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setProgressMsg(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Garmin Workout Push</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Sendet geplante Run-Workouts (Easy / Threshold / Tempo / Long / VO2max
        / Calibration) automatisch an deine Garmin-Uhr. Strength, Rest und
        Time-Trials werden nicht gepusht.
      </p>

      <div className="rounded-md border bg-muted/30 px-3 py-2 mb-3 text-xs text-muted-foreground space-y-1">
        <div>
          <span className="font-semibold text-foreground">Auto-Push:</span>{" "}
          läuft täglich um <strong>21:00 Berlin</strong> und pusht das Workout
          für den nächsten Tag.
        </div>
        <div>
          <span className="font-semibold text-foreground">Manuell:</span>{" "}
          &bdquo;Diese Woche jetzt syncen&ldquo; pusht <strong>sofort</strong> alle
          geplanten Sessions der nächsten 7 Tage. Bluetooth-Sync zur FR165
          dauert dann nochmal 15–60 Min mit iPhone in der Nähe.
        </div>
      </div>

      <label className="flex items-center justify-between py-2">
        <div className="min-w-0 flex-1 pr-3">
          <div className="text-sm font-medium">Auto-Push aktivieren</div>
          <div className="text-xs text-muted-foreground">
            Erforderlich, damit der Cron-Job und die Manual-Sync-Buttons
            funktionieren.
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          disabled={busy}
          className="h-5 w-5"
        />
      </label>

      {enabled && (
        <Button
          variant="outline"
          size="sm"
          onClick={syncNow}
          disabled={busy}
          className="mt-3"
        >
          {busy ? "Sende…" : "Diese Woche jetzt syncen"}
        </Button>
      )}

      {/* Live progress message */}
      {progressMsg && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--accent-ring)] bg-[var(--accent-muted)] px-3 py-2 text-xs text-[var(--accent)]">
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
          />
          <span className="tabular-nums">{progressMsg}</span>
        </div>
      )}

      {/* Per-workout list with live state */}
      {items && items.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--border-subtle)] rounded-md border">
          {items.map((w) => (
            <li
              key={`${w.date}-${w.type}`}
              className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-foreground">
                    {SHORT_TYPE[w.type] ?? w.type}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {w.date.slice(5)}
                  </span>
                  {w.durationMin && (
                    <span className="tabular-nums text-muted-foreground">
                      · {w.durationMin}min
                    </span>
                  )}
                </div>
                {w.resultError && (
                  <div className="mt-0.5 text-destructive break-words">
                    {w.resultError.slice(0, 120)}
                  </div>
                )}
                {w.state === "skipped" && w.reasonNotPushable && (
                  <div className="mt-0.5 text-muted-foreground italic">
                    {w.reasonNotPushable === "non_pushable_session"
                      ? "Nicht pushbar (Strength/Rest/TT)"
                      : "Kein HR-Target — wird nicht gepusht"}
                  </div>
                )}
              </div>
              <PushStateBadge state={w.state} />
            </li>
          ))}
        </ul>
      )}

      {doneMsg && (
        <p className="mt-3 text-sm text-muted-foreground">{doneMsg}</p>
      )}
      {err && (
        <p className="mt-2 text-sm text-destructive break-words">{err}</p>
      )}
    </Card>
  );
}

function PushStateBadge({ state }: { state: PushItemState }) {
  const config: Record<
    PushItemState,
    { label: string; className: string }
  > = {
    queued: {
      label: "wartet",
      className: "border-[var(--border-strong)] text-foreground-tertiary",
    },
    syncing: {
      label: "sende…",
      className:
        "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]",
    },
    synced: {
      label: "✓",
      className:
        "border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]",
    },
    failed: {
      label: "✗",
      className:
        "border-[var(--destructive)]/30 bg-[var(--destructive)]/10 text-[var(--destructive)]",
    },
    skipped: {
      label: "skip",
      className: "border-[var(--border-subtle)] text-muted-foreground/60",
    },
  };
  const c = config[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${c.className}`}
    >
      {c.label}
    </span>
  );
}

// ============================================
// Trainingstage (Sprint v0.10)
// ============================================
//
// Pickt forcedRestDays (Pflicht-Ruhetage) + preferredLongRunDay. Speichern
// triggert Macrocycle-Regeneration der zukünftigen Wochenpläne + Garmin-Resync.

const ISO_DAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]; // ISO 1..7
const ISO_DAY_FULL = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

function TrainingDaysSection({
  schedule,
  onSaved,
}: {
  schedule: { forcedRestDays: number[]; preferredLongRunDay: number };
  onSaved: () => void;
}) {
  const [restDays, setRestDays] = useState<number[]>(
    Array.isArray(schedule.forcedRestDays) ? [...schedule.forcedRestDays] : [3, 7],
  );
  const [longRunDay, setLongRunDay] = useState<number>(
    schedule.preferredLongRunDay ?? 6,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function toggleRestDay(iso: number) {
    if (iso === longRunDay) return; // can't pick long-run day as rest
    if (restDays.includes(iso)) {
      const next = restDays.filter((d) => d !== iso);
      if (next.length === 0) return; // need at least 1 rest day
      setRestDays(next);
    } else {
      if (restDays.length >= 4) return; // max 4
      setRestDays([...restDays, iso].sort());
    }
  }

  function selectLongRunDay(iso: number) {
    if (restDays.includes(iso)) return; // can't be a rest day
    setLongRunDay(iso);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/settings/training-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forcedRestDays: restDays,
          preferredLongRunDay: longRunDay,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        regenerated?: number;
        garminResync?: {
          considered: number;
          removed: number;
          repushed: number;
          errors: string[];
        };
        error?: string;
      };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);

      const parts: string[] = [];
      if (typeof data.regenerated === "number")
        parts.push(`${data.regenerated} Wochen regeneriert`);
      if (data.garminResync) {
        const g = data.garminResync;
        if (g.considered > 0)
          parts.push(
            `Garmin: ${g.repushed} re-pushed, ${g.removed} removed`,
          );
        if (g.errors.length > 0)
          setErr(`Garmin-Sync-Errors: ${g.errors.slice(0, 3).join(" | ")}`);
      }
      setMsg(parts.join(" · ") || "Gespeichert.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Trainingstage</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Welche Tage sind Pflicht-Ruhetage (z.B. Office, Familie)? Welcher Tag
        soll für den Long Run reserviert sein? Speichern regeneriert alle
        zukünftigen Wochenpläne und sendet sie an Garmin (falls aktiv).
      </p>

      {/* Pflicht-Ruhetage */}
      <div className="space-y-2 mb-4">
        <div className="text-sm font-medium">Pflicht-Ruhetage</div>
        <div className="flex flex-wrap gap-1">
          {ISO_DAY_LABELS.map((label, i) => {
            const iso = i + 1;
            const active = restDays.includes(iso);
            const isLongRun = iso === longRunDay;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => toggleRestDay(iso)}
                disabled={isLongRun || busy}
                title={
                  isLongRun
                    ? `${ISO_DAY_FULL[i]} ist Long-Run-Tag — kann kein Ruhetag sein`
                    : ISO_DAY_FULL[i]
                }
                className={`min-w-[2.5rem] rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]"
                    : "border-input text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                } ${isLongRun ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          1–4 Tage. Aktuell: {restDays.length}.
        </p>
      </div>

      {/* Long-Run-Day */}
      <div className="space-y-2 mb-4">
        <div className="text-sm font-medium">Long-Run-Tag</div>
        <div className="flex flex-wrap gap-1">
          {ISO_DAY_LABELS.map((label, i) => {
            const iso = i + 1;
            const active = iso === longRunDay;
            const isRest = restDays.includes(iso);
            return (
              <button
                key={iso}
                type="button"
                onClick={() => selectLongRunDay(iso)}
                disabled={isRest || busy}
                title={
                  isRest
                    ? `${ISO_DAY_FULL[i]} ist Pflicht-Ruhetag`
                    : ISO_DAY_FULL[i]
                }
                className={`min-w-[2.5rem] rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]"
                    : "border-input text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                } ${isRest ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      {err && (
        <p className="text-sm text-destructive break-words">{err}</p>
      )}

      <Button onClick={save} disabled={busy} className="mt-2">
        {busy ? "Regeneriere…" : "Speichern + Pläne neu generieren"}
      </Button>
    </Card>
  );
}

// ============================================
// HR Zones (Karvonen HRR)
// ============================================
function HrZonesSection({
  hrZones,
  onSaved,
}: {
  hrZones: HrZonesPayload;
  onSaved: () => void;
}) {
  const [hrMax, setHrMax] = useState<string>(
    hrZones.hrMax != null ? String(hrZones.hrMax) : "",
  );
  const [hrRest, setHrRest] = useState<string>(
    hrZones.hrRest != null ? String(hrZones.hrRest) : "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Live preview (matches server-side Karvonen).
  const hrMaxNum = Number.parseInt(hrMax, 10);
  const hrRestNum = Number.parseInt(hrRest, 10);
  const valid =
    Number.isFinite(hrMaxNum) &&
    Number.isFinite(hrRestNum) &&
    hrMaxNum >= 120 &&
    hrMaxNum <= 220 &&
    hrRestNum >= 30 &&
    hrRestNum <= 90 &&
    hrMaxNum - hrRestNum >= 30;

  const preview = valid
    ? (() => {
        const hrr = hrMaxNum - hrRestNum;
        return {
          z1Max: Math.round(hrRestNum + 0.75 * hrr),
          z2Max: Math.round(hrRestNum + 0.87 * hrr),
        };
      })()
    : null;

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hrMax: hrMaxNum,
          hrRest: hrRestNum,
          hrZonesSource: "manual",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setMsg("Gespeichert.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">HR Zones</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Karvonen HRR (Heart Rate Reserve) — Z1 ≤ 75% HRR, Z2 ≤ 87% HRR, Z3 &gt; 87%.
        Treibt die HR-basierte TID-Auswertung auf /progress.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">HRmax (bpm)</span>
          <input
            type="number"
            inputMode="numeric"
            value={hrMax}
            onChange={(e) => setHrMax(e.target.value)}
            min={120}
            max={220}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="z.B. 200"
          />
          <span className="text-xs text-muted-foreground">120–220</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">HRrest (bpm)</span>
          <input
            type="number"
            inputMode="numeric"
            value={hrRest}
            onChange={(e) => setHrRest(e.target.value)}
            min={30}
            max={90}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="z.B. 52"
          />
          <span className="text-xs text-muted-foreground">30–90</span>
        </label>
      </div>

      {preview ? (
        <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <ZoneBadge label="Z1 (easy)" range={`≤ ${preview.z1Max}`} cls="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
            <ZoneBadge
              label="Z2 (threshold)"
              range={`${preview.z1Max + 1}–${preview.z2Max}`}
              cls="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
            />
            <ZoneBadge
              label="Z3 (max)"
              range={`> ${preview.z2Max}`}
              cls="bg-red-500/15 text-red-700 dark:text-red-300"
            />
          </div>
          <p className="mt-2 text-muted-foreground">
            HRR = {hrMaxNum - hrRestNum} bpm
          </p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Beide Werte eingeben. HRmax − HRrest muss ≥ 30 sein.
        </p>
      )}

      {hrZones.configured && hrZones.updatedAt && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Zuletzt aktualisiert:{" "}
          {new Date(hrZones.updatedAt).toLocaleDateString("de-DE")}
          {hrZones.source ? ` · Quelle: ${hrZones.source}` : ""}
        </p>
      )}

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      <Button onClick={save} disabled={busy || !valid} className="mt-4">
        {busy ? "Speichere…" : "HR Zones speichern"}
      </Button>
    </Card>
  );
}

function ZoneBadge({
  label,
  range,
  cls,
}: {
  label: string;
  range: string;
  cls: string;
}) {
  return (
    <div className={`rounded-md px-2 py-1.5 ${cls}`}>
      <div className="text-[10px] uppercase opacity-70">{label}</div>
      <div className="font-semibold tabular-nums">{range}</div>
    </div>
  );
}

// ============================================
// AI Coach
// ============================================
function AiCoachSection({
  aiCoach,
  onSaved,
}: {
  aiCoach: SettingsResponse["aiCoach"];
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(aiCoach.enabled);
  const [modelOverride, setModelOverride] = useState<string>(
    aiCoach.modelOverride ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiCoachEnabled: enabled,
          aiModelPrimaryOverride: modelOverride || null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg("Gespeichert.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">AI Coach</h2>

      <label className="flex items-center justify-between py-2">
        <div>
          <span className="text-sm font-medium">AI Coach aktiv</span>
          <p className="text-xs text-muted-foreground">
            Wenn deaktiviert: keine Anthropic-Calls; UI zeigt Engine-Erklärungen.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-5 w-5"
        />
      </label>

      <label className="flex flex-col gap-1.5 mt-3">
        <span className="text-sm font-medium">Modell-Auswahl</span>
        <select
          value={modelOverride}
          onChange={(e) => setModelOverride(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Aktuell effektiv: {aiCoach.effectiveModel}. Opus ≈ $0.012/Anruf, Sonnet
          ≈ $0.005/Anruf.
        </span>
      </label>

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
      <Button onClick={save} disabled={busy} className="mt-4">
        {busy ? "Speichere…" : "Speichern"}
      </Button>
    </Card>
  );
}

// ============================================
// Performance / VDOT
// ============================================
function PerformanceSection({
  vdot,
  onSaved,
}: {
  vdot: SettingsResponse["vdot"];
  onSaved: () => void;
}) {
  const [showDialog, setShowDialog] = useState(false);
  const [prefillVdot, setPrefillVdot] = useState<number | null>(null);

  // Sprint v0.7: deep-link from /progress drift card. ?vdotPrefill=N opens
  // the dialog auto-populated with the suggested VDOT.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("vdotPrefill");
    if (!raw) return;
    const v = Number.parseInt(raw, 10);
    if (Number.isFinite(v) && v >= 30 && v <= 80) {
      setPrefillVdot(v);
      setShowDialog(true);
      // Strip the query so refresh doesn't re-open.
      params.delete("vdotPrefill");
      const next = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", next);
    }
  }, []);

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Performance</h2>
      <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Aktueller VDOT</p>
          <p className="text-2xl font-bold tabular-nums">{vdot.effective}</p>
        </div>
        {vdot.override != null && (
          <div>
            <p className="text-muted-foreground text-xs">Manueller Override</p>
            <p className="text-sm">
              {vdot.override} ·{" "}
              {vdot.overrideAt
                ? new Date(vdot.overrideAt).toLocaleDateString("de-DE")
                : ""}
            </p>
            {vdot.overrideRationale && (
              <p className="text-xs italic text-muted-foreground mt-1">
                &bdquo;{vdot.overrideRationale}&ldquo;
              </p>
            )}
          </div>
        )}
      </div>

      <Button
        onClick={() => setShowDialog(true)}
        variant="outline"
        size="sm"
        className="mt-4"
      >
        VDOT manuell überschreiben
      </Button>

      {showDialog && (
        <VdotOverrideDialog
          currentVdot={vdot.effective}
          prefillNewVdot={prefillVdot}
          onClose={() => {
            setShowDialog(false);
            setPrefillVdot(null);
          }}
          onSaved={() => {
            setShowDialog(false);
            setPrefillVdot(null);
            onSaved();
          }}
        />
      )}
    </Card>
  );
}

function VdotOverrideDialog({
  currentVdot,
  prefillNewVdot,
  onClose,
  onSaved,
}: {
  currentVdot: number;
  prefillNewVdot?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [newVdot, setNewVdot] = useState(prefillNewVdot ?? currentVdot);
  const [rationale, setRationale] = useState(
    prefillNewVdot != null
      ? "Empfehlung der Pace-Drift-Detection auf /progress"
      : "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const diff = Math.abs(newVdot - currentVdot);
  const isLargeDiff = diff > 3;

  async function submit() {
    setBusy(true);
    setErr(null);
    setWarn(null);
    try {
      const r = await fetch("/api/settings/vdot-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newVdot, rationale, confirmed }),
      });
      const data = await r.json();
      if (r.status === 409 && data.status === "CONFIRM_REQUIRED") {
        setWarn(data.message);
        return;
      }
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-lg w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-3">VDOT überschreiben</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Aktuell: <strong>{currentVdot}</strong>. Beim Speichern werden alle
          zukünftigen Run-Sessions mit neuen Pace-Targets aktualisiert.
        </p>

        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Neuer VDOT</span>
            <input
              type="number"
              value={newVdot}
              onChange={(e) => setNewVdot(Number.parseInt(e.target.value, 10) || 0)}
              min={30}
              max={80}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full"
            />
            <span className="text-xs text-muted-foreground">
              Differenz: {diff} Punkte
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Begründung</span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="z.B. inoffizieller 5k Test heute: 22:30"
              minLength={10}
              required
            />
            <span className="text-xs text-muted-foreground">
              Min. 10 Zeichen.
            </span>
          </label>

          {(isLargeDiff || warn) && (
            <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3">
              <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                ⚠ Große Änderung
              </p>
              <p className="text-xs mt-1 text-orange-700 dark:text-orange-400">
                {warn ??
                  `${diff} VDOT-Punkte ist groß. Bitte bestätigen, dass das beabsichtigt ist.`}
              </p>
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>Ja, ich möchte das wirklich.</span>
              </label>
            </div>
          )}
        </div>

        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} variant="outline" size="sm">
            Abbrechen
          </Button>
          <Button
            onClick={submit}
            disabled={
              busy ||
              rationale.trim().length < 10 ||
              (isLargeDiff && !confirmed)
            }
            size="sm"
          >
            {busy ? "Speichere…" : "Speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Notifications
// ============================================
function NotificationsSection({
  notifications,
  onSaved,
}: {
  notifications: NotifPrefs;
  onSaved: () => void;
}) {
  const [prefs, setPrefs] = useState<NotifPrefs>(notifications);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationPrefs: prefs }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMsg("Gespeichert.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const toggles: { key: keyof NotifPrefs; label: string; hint: string }[] = [
    {
      key: "garminFailure",
      label: "Garmin Sync Failures",
      hint: "Warnung bei 2+ aufeinanderfolgenden Sync-Fehlern.",
    },
    {
      key: "blockReviewDue",
      label: "Block Review fällig",
      hint: "Wenn ein Block-Ende erreicht ist und Review aussteht.",
    },
    {
      key: "timeTrialToday",
      label: "Time Trial Tag (Block 5)",
      hint: "Race-Day-Reminder für die 5k Time Trials.",
    },
    {
      key: "vdotCalibrated",
      label: "VDOT-Kalibrierung",
      hint: "Wenn VDOT geändert wird (auto oder manuell).",
    },
  ];

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-3">Notifications</h2>
      <div className="space-y-2">
        {toggles.map((t) => (
          <label key={t.key} className="flex items-start justify-between py-2 border-b last:border-b-0">
            <div className="min-w-0 flex-1 pr-3">
              <div className="text-sm font-medium">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.hint}</div>
            </div>
            <input
              type="checkbox"
              checked={prefs[t.key]}
              onChange={(e) => setPrefs({ ...prefs, [t.key]: e.target.checked })}
              className="h-5 w-5"
            />
          </label>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
      <Button onClick={save} disabled={busy} className="mt-3">
        {busy ? "Speichere…" : "Speichern"}
      </Button>
    </Card>
  );
}

// ============================================
// Danger Zone
// ============================================
function DangerZone() {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="border-destructive/30">
      <h2 className="text-lg font-semibold text-destructive mb-3">Danger Zone</h2>

      <div className="space-y-4">
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
          <h3 className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">
            Plan zurücksetzen / Re-Onboarding
          </h3>
          <p className="mt-2 text-xs text-yellow-800 dark:text-yellow-200">
            Wenn du dein Goal änderst oder die Engine-Logik aktualisiert wurde,
            kannst du einen frischen Trainingsplan generieren.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
            <div>
              <p className="font-semibold text-yellow-900 dark:text-yellow-100">
                Was bleibt erhalten:
              </p>
              <ul className="mt-1 space-y-0.5 text-yellow-800 dark:text-yellow-200">
                <li>✓ Alle vergangenen Workouts &amp; History</li>
                <li>✓ Sensor-Daten und Trends</li>
                <li>✓ Coach-Conversations</li>
                <li>✓ Effektiver VDOT (sofern explizit gesetzt)</li>
                <li>✓ HR-Zonen + Garmin-Credentials</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-yellow-900 dark:text-yellow-100">
                Was wird neu:
              </p>
              <ul className="mt-1 space-y-0.5 text-yellow-800 dark:text-yellow-200">
                <li>↻ Macrocycle &amp; alle Phases</li>
                <li>↻ Wochenpläne (Run + Strength) mit aktueller Engine-Logik</li>
                <li>↻ Initial-VDOT aus aktueller Bestleistung (Daniels)</li>
                <li>↻ Strength-Templates inkl. Superset-Felder</li>
              </ul>
            </div>
          </div>

          {!confirming ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setConfirming(true)}
            >
              Re-Onboarding starten
            </Button>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/onboarding"
                className="inline-flex items-center justify-center rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                Bestätigen → /onboarding
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Abbrechen
              </Button>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1">Weitere Cleanup-Optionen:</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            <li>Alle AI-Conversations löschen <span className="opacity-50">(folgt)</span></li>
            <li>Account löschen <span className="opacity-50">(folgt)</span></li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ============================================
// Meine Gewichte (Sprint v0.11) — 1RM input per relevant exercise
// ============================================
//
// Lists every exercise with a `loadPct` from the current + next strength
// block and lets Q enter a 1RM kg value. The engine snaps `loadPct × 1RM`
// to 2.5kg plates and writes it to `Exercise.loadAbs` for every future
// strength session, so /today shows e.g. "4 × 5 @ 98 kg (82%)" instead of
// just "82%".
//
// Side-by-side: the engine's rolling-median estimate from the last 28 days
// of training data (Epley + RIR-corrected) so Q can spot drift without
// re-doing a 5RM test.

type ExerciseMaxRow = {
  name: string;
  loadPctSample: number;
  blocks: number[];
  currentRM: number | null;
  engineRM: number | null;
  engineDataPoints: number;
};

type ExerciseMaxResponse = {
  status: "ok";
  currentBlock: number;
  source: string | null;
  updatedAt: string | null;
  exercises: ExerciseMaxRow[];
};

function ExerciseMaxSection() {
  const [data, setData] = useState<ExerciseMaxResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings/exercise-max");
      if (!r.ok) {
        setErr(`HTTP ${r.status}`);
        return;
      }
      const json = (await r.json()) as ExerciseMaxResponse;
      setData(json);
      // Seed draft inputs from stored values (empty string when null).
      const seed: Record<string, string> = {};
      for (const ex of json.exercises) {
        seed[ex.name] = ex.currentRM != null ? String(ex.currentRM) : "";
      }
      setDraft(seed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!data) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      // Build payload: only include exercises with a numeric value.
      const payload: Record<string, number> = {};
      for (const ex of data.exercises) {
        const raw = draft[ex.name]?.trim();
        if (!raw) continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) payload[ex.name] = n;
      }
      const res = await fetch("/api/settings/exercise-max", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseMaxEstimates: payload }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { regenerated: number };
      setMsg(
        `Gespeichert. ${j.regenerated} zukünftige Wochenpläne mit neuen Gewichten regeneriert.`,
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Meine Gewichte (1RM Schätzung)</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Gib dein geschätztes 1RM ein oder das Gewicht mit dem du maximal 5
        Wiederholungen schaffst. Die App rechnet Prozent-Vorgaben automatisch
        in Kilogramm um (auf 2.5 kg gerundet) und korrigiert die Schätzung
        nach 2-3 Wochen Training basierend auf deinen tatsächlichen Daten.
      </p>

      {err && (
        <p className="mb-3 text-sm text-[var(--color-destructive)]">{err}</p>
      )}
      {msg && <p className="mb-3 text-sm text-muted-foreground">{msg}</p>}

      {!data ? (
        <p className="text-sm text-muted-foreground">Lade…</p>
      ) : data.exercises.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Keine Übungen mit prozent-basierten Gewichten in Block {data.currentBlock}.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.exercises.map((ex) => (
            <li
              key={ex.name}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
            >
              <div className="min-w-[12ch] flex-1">
                <p className="text-sm font-medium">{ex.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {ex.blocks.map((b) => `Block ${b}`).join(" · ")}
                </p>
              </div>
              <div className="flex items-baseline gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="2.5"
                  min={0}
                  max={500}
                  value={draft[ex.name] ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [ex.name]: e.target.value }))
                  }
                  className="num w-24 rounded-md bg-input px-2 py-1 text-right text-sm"
                  placeholder="—"
                />
                <span className="text-sm text-muted-foreground">kg</span>
              </div>
              <p className="basis-full text-right text-[11px] text-muted-foreground tabular-nums">
                {ex.engineRM != null
                  ? `Engine: ~${Math.round(ex.engineRM)} kg (${ex.engineDataPoints} Sets)`
                  : "Engine: — (noch keine Daten)"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Button
        onClick={save}
        disabled={busy || !data}
        className="mt-4"
      >
        {busy ? "Speichere…" : "Speichern + Pläne neu generieren"}
      </Button>

      {data?.updatedAt && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Zuletzt aktualisiert:{" "}
          {new Date(data.updatedAt).toLocaleString("de-DE")} ·{" "}
          Quelle: {data.source ?? "—"}
        </p>
      )}
    </Card>
  );
}

// ============================================
// Knie-Status (Sprint v0.12) — therapy-phase manual override
// ============================================
//
// Q's Patellatendinopathie ist abgeklungen — er will nicht jeden Strength-
// Workout mit Wall Sit eröffnen. Vier Phasen:
// - REACTIVE        Akute Schmerzen, Wall Sit + konservative Lasten
// - DISREPAIR       Schmerzen nach Belastung, Wall Sit + moderate Lasten
// - REMODELING      Selten Schmerzen (nur bei hoher Last), kein Wall Sit
// - SPORT_SPECIFIC  Beschwerdefrei, kein Wall Sit, volle Lasten
//
// `null` = Auto: Engine leitet täglich aus DailySensorData.therapyPhase ab
// (Knee-Score, VISA-P-Trend). Default für neue Konten.

type TherapyPhase = "REACTIVE" | "DISREPAIR" | "REMODELING" | "SPORT_SPECIFIC";

const PHASE_OPTIONS: Array<{
  value: TherapyPhase | null;
  label: string;
  description: string;
}> = [
  {
    value: null,
    label: "Auto",
    description: "Engine entscheidet täglich anhand Knee-Score + VISA-P.",
  },
  {
    value: "REACTIVE",
    label: "REACTIVE",
    description: "Akute Schmerzen. Wall Sit + konservative Lasten.",
  },
  {
    value: "DISREPAIR",
    label: "DISREPAIR",
    description: "Schmerzen nach Belastung. Wall Sit + moderate Lasten.",
  },
  {
    value: "REMODELING",
    label: "REMODELING",
    description:
      "Selten Schmerzen (nur bei hoher Last). Kein Wall Sit.",
  },
  {
    value: "SPORT_SPECIFIC",
    label: "SPORT_SPECIFIC",
    description: "Beschwerdefrei. Kein Wall Sit, volle Lasten.",
  },
];

function KneeStatusSection({
  current,
  onSaved,
}: {
  current: TherapyPhase | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<TherapyPhase | null>(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Sync draft when parent reloads (e.g. after sibling section save).
  useEffect(() => {
    setDraft(current);
  }, [current]);

  async function save(phase: TherapyPhase | null) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/settings/therapy-phase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ therapyPhase: phase }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as {
        regenerated: number;
        garminResync?: { repushed: number; removed: number };
      };
      const garmin = j.garminResync
        ? ` · Garmin: ${j.garminResync.repushed} re-pushed, ${j.garminResync.removed} removed`
        : "";
      setMsg(
        `Gespeichert. ${j.regenerated} zukünftige Wochenpläne regeneriert.${garmin}`,
      );
      setDraft(phase);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-1">Knie-Status</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Steuert ob Wall Sit als HSR-Tendon-Stimulus in jede Strength-Session
        eingefügt wird (REACTIVE / DISREPAIR) oder weggelassen wird
        (REMODELING / SPORT_SPECIFIC). Aktuell:{" "}
        <strong>{draft ?? "Auto (engine-derived)"}</strong>.
      </p>

      {err && (
        <p className="mb-3 text-sm text-[var(--color-destructive)]">{err}</p>
      )}
      {msg && <p className="mb-3 text-sm text-muted-foreground">{msg}</p>}

      <ul className="flex flex-col gap-2">
        {PHASE_OPTIONS.map((opt) => {
          const isActive = draft === opt.value;
          return (
            <li key={opt.label}>
              <button
                type="button"
                disabled={busy}
                onClick={() => save(opt.value)}
                aria-pressed={isActive}
                className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  isActive
                    ? "border-[var(--color-foreground)] bg-[var(--color-surface)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                }`}
              >
                <span
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${
                    isActive
                      ? "border-[var(--color-foreground)] bg-[var(--color-foreground)]"
                      : "border-[var(--color-border-strong)]"
                  }`}
                  aria-hidden
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
