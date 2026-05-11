-- AlterTable
ALTER TABLE "DailySensorData" ADD COLUMN     "activeKilocalories" INTEGER,
ADD COLUMN     "averageStress" DOUBLE PRECISION,
ADD COLUMN     "bmrKilocalories" INTEGER,
ADD COLUMN     "bodyBatteryEnd" INTEGER,
ADD COLUMN     "totalKilocalories" INTEGER;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "activeInjuries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "preventionExercises" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CoachingLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "budgetPerDay" DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    "proteinTarget" INTEGER NOT NULL,
    "deficitKcal" INTEGER NOT NULL DEFAULT 500,
    "calibrationStatus" TEXT NOT NULL DEFAULT 'pending',
    "calibratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayPlan" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "tdeeEstimate" INTEGER NOT NULL,
    "calorieTarget" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "carbsG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "slots" JSONB NOT NULL,

    CONSTRAINT "DayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyNutritionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayType" TEXT NOT NULL,
    "calorieTarget" INTEGER NOT NULL,
    "garminTDEE" INTEGER,
    "adjustment" JSONB,
    "followed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyNutritionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachingLog_userId_createdAt_idx" ON "CoachingLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MealPlan_userId_status_idx" ON "MealPlan"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DayPlan_mealPlanId_dayType_key" ON "DayPlan"("mealPlanId", "dayType");

-- CreateIndex
CREATE UNIQUE INDEX "DailyNutritionLog_userId_date_key" ON "DailyNutritionLog"("userId", "date");

-- AddForeignKey
ALTER TABLE "CoachingLog" ADD CONSTRAINT "CoachingLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyNutritionLog" ADD CONSTRAINT "DailyNutritionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

