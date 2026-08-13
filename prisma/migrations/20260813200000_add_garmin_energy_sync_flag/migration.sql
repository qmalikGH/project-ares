-- Sprint 2.8: the calorie columns get their own sync flag.
--
-- GarminSyncLog carried five flags and lib/garmin/sync.ts derived
-- status = SUCCESS iff all five were true. DailySensorData's energy columns
-- (totalKilocalories / activeKilocalories / bmrKilocalories) had no flag, so a
-- SUCCESS row was structurally compatible with all three being NULL — which is
-- what 2026-08-12 and 2026-08-13 recorded.
ALTER TABLE "GarminSyncLog" ADD COLUMN "energySyncOk" BOOLEAN NOT NULL DEFAULT false;

-- Deliberately NO backfill UPDATE. Existing rows get false, meaning "no evidence
-- the energy fields synced" — true for every historical row, because nothing ever
-- wrote this flag. Setting them true would retroactively certify precisely the
-- days we know are broken. Historical rows therefore read status = 'SUCCESS'
-- alongside energySyncOk = false; that is the honest record of the defect, not a
-- data error.
