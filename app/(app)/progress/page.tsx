export const dynamic = "force-dynamic";

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Progress</h1>
      <p className="mt-2 text-muted-foreground">
        Goal-Tracking, VDOT-Verlauf, Block-Status, Adherence — kommt in Sprint v0.4.
      </p>
      <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
        <li>• 5k Goal Tracker (24:30 → 22:00)</li>
        <li>• VDOT-Verlauf über alle Blöcke</li>
        <li>• Block-Progress mit Performance-Markern</li>
        <li>• TID-Distribution: Plan vs Actual</li>
      </ul>
    </div>
  );
}
