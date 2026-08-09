-- Sprint 2.6 (A6): provenance for VDOT, mirroring hrZonesSource / exerciseMaxSource.
-- VDOT was the only calibrated value without a *Source field, so nothing could
-- tell a deliberate manual pin from an engine write. The auto-calibration needs
-- that distinction: only "manual" is protected for 28 days.

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "vdotSource" TEXT;

-- Backfill the one known provisional value.
-- The VDOT set during the 2026-08-09 comeback restart is an operator placeholder,
-- not a deliberate pin — its own rationale says "Neumessung ueber die rollende
-- Rekalibrierung sobald >=5 Laeufe geloggt sind". Labelling it "manual" would
-- protect it for 28 days and contradict that recorded intent.
-- Any other pre-existing row stays NULL, which means "not manual" — a measurement
-- may supersede it. Writers from here on set the column explicitly.
UPDATE "UserSettings"
SET "vdotSource" = 'comeback_placeholder'
WHERE "vdotSource" IS NULL
  AND "vdotOverride" IS NOT NULL
  AND "vdotOverrideRationale" LIKE 'Comeback %';
