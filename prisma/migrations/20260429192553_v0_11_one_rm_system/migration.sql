-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "exerciseMaxEstimates" JSONB,
ADD COLUMN     "exerciseMaxSource" TEXT,
ADD COLUMN     "exerciseMaxUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExerciseLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "repsCompleted" INTEGER NOT NULL,
    "rpe" DOUBLE PRECISION,
    "estimatedOneRM" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExerciseLog_userId_exerciseName_date_idx" ON "ExerciseLog"("userId", "exerciseName", "date" DESC);

-- AddForeignKey
ALTER TABLE "ExerciseLog" ADD CONSTRAINT "ExerciseLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
