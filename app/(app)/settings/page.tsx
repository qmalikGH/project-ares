export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mt-2 text-muted-foreground">
        Konfiguration und Profil — kommt in Sprint v0.5.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
        <li>• Garmin-Credentials Status + Re-Auth</li>
        <li>• AI-Coach an/aus Toggle</li>
        <li>• Manueller Phase-Override</li>
        <li>• Re-Onboarding</li>
        <li>• VDOT manuell überschreiben</li>
      </ul>
    </div>
  );
}
