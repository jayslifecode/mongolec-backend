-- Additive: a rally can be featured on the Rally for Rangers home hero (its heroVideo plays
-- there). Safe on production with existing data and safe to re-run.
-- Apply BEFORE deploying the backend that reads "isFeatured", or every rally query fails.

ALTER TABLE "rallies" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;

-- At most one featured (not deleted) rally per organisation. The API un-features the others
-- in the same transaction before featuring one, so this only catches mistakes.
CREATE UNIQUE INDEX IF NOT EXISTS "rallies_one_featured_per_tenant"
  ON "rallies"("tenantId")
  WHERE "isFeatured" AND "deletedAt" IS NULL;
