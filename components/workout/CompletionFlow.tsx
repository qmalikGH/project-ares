"use client";

import { useState } from "react";
import { GarminMatchStep } from "./GarminMatchStep";
import { SetLoggerStep } from "./SetLoggerStep";
import { ResultStep } from "./ResultStep";
import type { Exercise, StrengthExecutedSession } from "@/lib/coach-engine/types";

type Step = "garmin" | "strength_log" | "result";

export function CompletionFlow({
  workoutId,
  sessionType,
  plannedExercises,
  durationMin,
  onComplete,
}: {
  workoutId: string;
  sessionType: string;
  plannedExercises: Exercise[];
  durationMin: number;
  onComplete: () => void;
}) {
  const isRun =
    sessionType.endsWith("_run") ||
    sessionType === "long_run" ||
    sessionType === "vo2max_intervals" ||
    sessionType === "calibration_run" ||
    sessionType === "time_trial_5k";
  const isStrength = sessionType.startsWith("strength");

  const initialStep: Step = isRun ? "garmin" : isStrength ? "strength_log" : "result";

  const [step, setStep] = useState<Step>(initialStep);
  const [garminActivityId, setGarminActivityId] = useState<number | null>(null);
  const [strengthExecution, setStrengthExecution] = useState<
    Pick<StrengthExecutedSession, "exercises" | "durationActualMin"> | null
  >(null);

  if (step === "garmin") {
    return (
      <GarminMatchStep
        workoutId={workoutId}
        onSelected={(id) => {
          setGarminActivityId(id);
          setStep("result");
        }}
        onSkip={() => setStep("result")}
      />
    );
  }

  if (step === "strength_log") {
    return (
      <SetLoggerStep
        plannedExercises={plannedExercises}
        durationMin={durationMin}
        onComplete={(exec) => {
          setStrengthExecution(exec);
          setStep("result");
        }}
      />
    );
  }

  return (
    <ResultStep
      workoutId={workoutId}
      garminActivityId={garminActivityId}
      strengthExecution={strengthExecution}
      isStrength={isStrength}
      defaultDurationMin={durationMin}
      onSubmitted={onComplete}
    />
  );
}
