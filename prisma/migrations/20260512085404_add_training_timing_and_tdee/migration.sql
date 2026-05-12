-- AlterTable
ALTER TABLE "DayTypeConfig" ADD COLUMN     "dinnerNeedsCarbs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tdeeEstimate" INTEGER,
ADD COLUMN     "trainingWindow" TEXT NOT NULL DEFAULT 'none';
