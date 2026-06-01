-- Sprint 2.1 #0: denormalized periodization snapshot on ExerciseLog.
-- workoutId/slot/isDeload/weekInBlock are written at session-completion time
-- so they stay stable against later resetBlock week-renumbering.

-- AlterTable
ALTER TABLE "ExerciseLog" ADD COLUMN     "workoutId" TEXT,
ADD COLUMN     "slot" TEXT,
ADD COLUMN     "isDeload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weekInBlock" INTEGER;

-- CreateIndex
CREATE INDEX "ExerciseLog_userId_exerciseName_slot_date_idx" ON "ExerciseLog"("userId", "exerciseName", "slot", "date" DESC);
