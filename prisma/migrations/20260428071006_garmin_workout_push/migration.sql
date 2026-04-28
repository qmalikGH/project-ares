-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "garminWorkoutPushEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "garminPushError" TEXT,
ADD COLUMN     "garminPushStatus" TEXT,
ADD COLUMN     "garminScheduledAt" TIMESTAMP(3),
ADD COLUMN     "garminScheduledWorkoutId" TEXT,
ADD COLUMN     "garminWorkoutId" TEXT;
