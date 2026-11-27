// Sprint 3.4 (#28, Phase 0.2): one display name for planned exercises.
//
// The Deadlift back-off sets share the lift's name with the top sets on
// purpose (one TM, one ExerciseLog lift). Every list that renders exercises —
// day view, /today, the wizard, /confirm and the description pushed to the
// watch — must still show them as their own entry, otherwise Kraft A reads as
// "2× Deadlift". Pure, so both client components and server code can use it.

export const BACKOFF_SUFFIX = "(Back-off)";

export function exerciseDisplayName(ex: { name: string; isBackoff?: boolean | null }): string {
  return ex.isBackoff ? `${ex.name} ${BACKOFF_SUFFIX}` : ex.name;
}
