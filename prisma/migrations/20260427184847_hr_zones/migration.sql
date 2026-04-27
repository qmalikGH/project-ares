-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "hrMax" INTEGER,
ADD COLUMN     "hrRest" INTEGER,
ADD COLUMN     "hrZonesSource" TEXT,
ADD COLUMN     "hrZonesUpdatedAt" TIMESTAMP(3);
