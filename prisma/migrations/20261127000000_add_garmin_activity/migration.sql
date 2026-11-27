-- Sprint 3.4 (#28), Teil A: raw Garmin activities.
--
-- Until now an activity only reached the database by being matched to a
-- planned Workout (exact workoutId on the same day). Every other run was
-- never stored. GarminActivity keeps every activity the watch records,
-- independent of plan and sport; matching is a separate step.

-- GarminSyncLog.targetDate: which day a row synced. Without it a gap-sweep
-- row for D-4 showed up as "last sync", and the sweep could not tell which
-- days it had already retried. Existing rows stay NULL (unknown).
ALTER TABLE "GarminSyncLog" ADD COLUMN     "targetDate" DATE;

-- CreateTable
CREATE TABLE "GarminActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "activityName" TEXT,
    "startTimeLocal" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "startTimeGMT" TIMESTAMP(3),
    "category" TEXT NOT NULL,
    "garminType" TEXT,
    "durationSec" INTEGER NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "averageHr" INTEGER,
    "maxHr" INTEGER,
    "averagePaceSecPerKm" INTEGER,
    "elevationGainM" INTEGER,
    "calories" INTEGER,
    "workoutId" TEXT,
    "splits" JSONB,
    "hrZones" JSONB,
    "raw" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "detailFetchedAt" TIMESTAMP(3),
    "workoutRefId" TEXT,

    CONSTRAINT "GarminActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GarminActivity_userId_localDate_idx" ON "GarminActivity"("userId", "localDate");

-- CreateIndex
CREATE INDEX "GarminActivity_workoutRefId_idx" ON "GarminActivity"("workoutRefId");

-- CreateIndex
CREATE UNIQUE INDEX "GarminActivity_userId_activityId_key" ON "GarminActivity"("userId", "activityId");

-- One Garmin activity completes at most one session. Checked before this
-- migration with scripts/check-activity-duplicates.ts (result in #28). If
-- duplicates exist, this statement fails and the build stops — resolve them
-- first, never by dropping the index. NULLs do not collide.
CREATE UNIQUE INDEX "Workout_userId_garminActivityId_key" ON "Workout"("userId", "garminActivityId");

-- CreateIndex
CREATE INDEX "GarminSyncLog_userId_targetDate_idx" ON "GarminSyncLog"("userId", "targetDate");

-- AddForeignKey
ALTER TABLE "GarminActivity" ADD CONSTRAINT "GarminActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A deleted Workout (materializeWorkouts removes orphans) unlinks the
-- activity; the raw row itself stays.
ALTER TABLE "GarminActivity" ADD CONSTRAINT "GarminActivity_workoutRefId_fkey" FOREIGN KEY ("workoutRefId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
