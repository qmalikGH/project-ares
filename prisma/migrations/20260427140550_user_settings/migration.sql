-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "garminUsernameOverride" TEXT,
    "garminPasswordOverride" TEXT,
    "aiCoachEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiModelPrimaryOverride" TEXT,
    "vdotOverride" INTEGER,
    "vdotOverrideAt" TIMESTAMP(3),
    "vdotOverrideRationale" TEXT,
    "notificationPrefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
