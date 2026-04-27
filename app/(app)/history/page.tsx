export const dynamic = "force-dynamic";

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">History</h1>
      <p className="mt-2 text-muted-foreground">
        Workout-Historie und Filter — kommt in Sprint v0.4.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
        <li>• Alle absolvierten Workouts mit RPE + Modulationen</li>
        <li>• Filter nach Typ (Run / Strength / Time Trial)</li>
        <li>• Block-Übergreifender Verlauf</li>
        <li>• Notes durchsuchbar</li>
      </ul>
    </div>
  );
}
