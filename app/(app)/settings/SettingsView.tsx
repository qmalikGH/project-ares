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
  garmin: { hasOverride: boolean; usernameDisplay: string | null };
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
      <HrZonesSection hrZones={data.hrZones} onSaved={load} />
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
