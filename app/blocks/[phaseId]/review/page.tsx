import BlockReviewClient from "./BlockReviewClient";

export const dynamic = "force-dynamic";

export default async function BlockReviewPage({
  params,
}: {
  params: Promise<{ phaseId: string }>;
}) {
  const { phaseId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <BlockReviewClient phaseId={phaseId} />
    </main>
  );
}
