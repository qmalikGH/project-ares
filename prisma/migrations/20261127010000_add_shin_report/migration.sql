-- Sprint 3.4 (#28), Teil C3: the shin as a weekly signal.
--
-- Until now the volume gate only knew the shin score of a session rated in
-- /confirm. ShinReport adds two more sources: a one-tap card on /today and the
-- coaching action reportShinStatus. The gate reads the highest value of the
-- last 14 days across all of them; no report in 14 days stays "hold".

-- CreateTable
CREATE TABLE "ShinReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "painNrs" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShinReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShinReport_userId_date_idx" ON "ShinReport"("userId", "date");

-- One report per day and source; a second tap the same day replaces it.
CREATE UNIQUE INDEX "ShinReport_userId_date_source_key" ON "ShinReport"("userId", "date", "source");

-- AddForeignKey
ALTER TABLE "ShinReport" ADD CONSTRAINT "ShinReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
