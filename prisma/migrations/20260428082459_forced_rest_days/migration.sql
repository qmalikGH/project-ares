-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "forcedRestDays" INTEGER[] DEFAULT ARRAY[3, 7]::INTEGER[],
ADD COLUMN     "preferredLongRunDay" INTEGER NOT NULL DEFAULT 6;
