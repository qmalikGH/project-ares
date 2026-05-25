-- Sprint v1.6: Add composite unique constraint on Workout(userId, date, type)
-- Enables upsert in materializeWorkouts() and prevents duplicate workout rows.

-- Step 1: Remove duplicates (keep the newest row per userId+date+type).
DELETE FROM "Workout"
WHERE id NOT IN (
  SELECT DISTINCT ON ("userId", "date", "type") id
  FROM "Workout"
  ORDER BY "userId", "date", "type", "createdAt" DESC
);

-- Step 2: Add unique constraint.
CREATE UNIQUE INDEX "Workout_userId_date_type_key" ON "Workout"("userId", "date", "type");
