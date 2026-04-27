import DayDetailView from "./DayDetailView";

export const dynamic = "force-dynamic";

export default async function DayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <DayDetailView date={date} />;
}
