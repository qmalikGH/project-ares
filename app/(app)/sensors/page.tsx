export const dynamic = "force-dynamic";

export default function SensorsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Sensors</h1>
      <p className="mt-2 text-muted-foreground">
        Sensor-Detail-Charts und Baselines — kommt in Sprint v0.4.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
        <li>• HRV-Verlauf (28d Baseline + Trend)</li>
        <li>• Sleep Score + Schlafdauer</li>
        <li>• RHR-Trend mit Standardabweichung</li>
        <li>• Body Battery + Readiness Korrelation</li>
        <li>• Knee Score Verlauf</li>
      </ul>
    </div>
  );
}
