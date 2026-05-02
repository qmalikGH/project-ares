-- AlterTable
ALTER TABLE "Macrocycle" ADD COLUMN     "annualGoalId" TEXT,
ADD COLUMN     "evaluatedAt" TIMESTAMP(3),
ADD COLUMN     "evaluation" JSONB,
ADD COLUMN     "focusMode" TEXT DEFAULT 'balanced';

-- CreateTable
CREATE TABLE "Vision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "targets" JSONB NOT NULL,
    "timeHorizon" TEXT NOT NULL DEFAULT '3-5 years',
    "notes" TEXT,

    CONSTRAINT "Vision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualGoal" (
    "id" TEXT NOT NULL,
    "visionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "targets" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "evaluation" JSONB,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "AnnualGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vision_userId_status_idx" ON "Vision"("userId", "status");

-- CreateIndex
CREATE INDEX "AnnualGoal_userId_status_idx" ON "AnnualGoal"("userId", "status");

-- AddForeignKey
ALTER TABLE "Vision" ADD CONSTRAINT "Vision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualGoal" ADD CONSTRAINT "AnnualGoal_visionId_fkey" FOREIGN KEY ("visionId") REFERENCES "Vision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualGoal" ADD CONSTRAINT "AnnualGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Macrocycle" ADD CONSTRAINT "Macrocycle_annualGoalId_fkey" FOREIGN KEY ("annualGoalId") REFERENCES "AnnualGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
