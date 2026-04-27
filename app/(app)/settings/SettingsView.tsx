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
          onClose={() => setShowDialog(false)}
          onSaved={() => {
            setShowDialog(false);
            onSaved();
          }}
        />
      )}
    </Card>
  );
}

function VdotOverrideDialog({
  currentVdot,
  onClose,
  onSaved,
}: {
  currentVdot: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [newVdot, setNewVdot] = useState(currentVdot);
  const [rationale, setRationale] = useState("");
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
  return (
    <Card className="border-destructive/30">
      <h2 className="text-lg font-semibold text-destructive mb-3">Danger Zone</h2>
      <p className="text-xs text-muted-foreground mb-3">
        In v0.5 noch nicht implementiert. Cleanup-Optionen folgen in v0.6.
      </p>
      <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
        <li>Macrocycle abbrechen</li>
        <li>Alle AI-Conversations löschen</li>
        <li>Account löschen</li>
      </ul>
    </Card>
  );
}
