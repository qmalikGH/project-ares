import TodayDashboard from "./TodayDashboard";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <TodayDashboard />
    </main>
  );
}
