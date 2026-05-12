-- CreateTable
CREATE TABLE "DayTypeConfig" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "calorieTarget" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "carbsG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "fixedSlots" JSONB NOT NULL,
    "mainMealRecipeId" TEXT NOT NULL,
    "mainMealRatio" DOUBLE PRECISION NOT NULL,
    "dinnerRecipeId" TEXT NOT NULL,
    "dinnerRatio" DOUBLE PRECISION NOT NULL,
    "flexDessertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayTypeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputedMealSlot" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "slotName" TEXT NOT NULL,
    "recipeId" TEXT,
    "recipeName" TEXT,
    "items" JSONB NOT NULL,
    "totalKcal" DOUBLE PRECISION NOT NULL,
    "totalProtein" DOUBLE PRECISION NOT NULL,
    "totalCarbs" DOUBLE PRECISION NOT NULL,
    "totalFat" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputedMealSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayTypeConfig_planId_dayType_key" ON "DayTypeConfig"("planId", "dayType");

-- CreateIndex
CREATE UNIQUE INDEX "ComputedMealSlot_planId_dayType_slotName_key" ON "ComputedMealSlot"("planId", "dayType", "slotName");

-- AddForeignKey
ALTER TABLE "DayTypeConfig" ADD CONSTRAINT "DayTypeConfig_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputedMealSlot" ADD CONSTRAINT "ComputedMealSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
