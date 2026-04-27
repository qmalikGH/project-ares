import OnboardingForm from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Project Ares — Onboarding</h1>
        <p className="mt-2 text-muted-foreground">
          Definiere dein Ziel. Die Engine generiert daraus den 20-Wochen-Macrozyklus.
        </p>
      </header>
      <OnboardingForm />
    </main>
  );
}
