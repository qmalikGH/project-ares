import { Suspense } from "react";

import LoginForm from "./LoginForm";

export const metadata = { title: "Anmelden — Project Ares" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Project Ares</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Persönliche Trainings- und Gesundheitsdaten. Anmeldung erforderlich.
        </p>
      </header>
      {/* LoginForm reads `?next=` via useSearchParams, which needs a Suspense
          boundary for the page to prerender. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
