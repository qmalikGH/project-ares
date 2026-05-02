-- AlterTable
ALTER TABLE "DailySensorData" ADD COLUMN     "bodyWeightKg" DOUBLE PRECISION,
ADD COLUMN     "bodyWeightSource" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "currentWeightKg" DOUBLE PRECISION,
ADD COLUMN     "currentWeightUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "targetWeightKg" DOUBLE PRECISION;
