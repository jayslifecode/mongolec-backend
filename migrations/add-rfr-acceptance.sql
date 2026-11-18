-- Additive: Rally for Rangers round 4 (acceptance letter, photo credit). Safe to run on
-- production with existing data and safe to re-run: only ADD COLUMN / CREATE ... IF NOT EXISTS.

ALTER TABLE "rallies" ADD COLUMN IF NOT EXISTS "photoCredit" TEXT;
ALTER TABLE "rallies" ADD COLUMN IF NOT EXISTS "acceptanceTerms" JSONB;

ALTER TABLE "rally_applications" ADD COLUMN IF NOT EXISTS "acceptanceToken" TEXT;
ALTER TABLE "rally_applications" ADD COLUMN IF NOT EXISTS "acceptanceTokenCreatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "rally_applications_acceptanceToken_key"
  ON "rally_applications"("acceptanceToken");

CREATE TABLE IF NOT EXISTS "rally_acceptances" (
  "id"                  TEXT PRIMARY KEY,
  "applicationId"       TEXT NOT NULL REFERENCES "rally_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tenantId"            TEXT NOT NULL,
  "firstName"           TEXT NOT NULL,
  "lastName"            TEXT NOT NULL,
  "email"               TEXT NOT NULL,
  "agreedToCommitment"  BOOLEAN NOT NULL,
  "agreedToLiability"   BOOLEAN NOT NULL,
  "usePastPhotoAndBio"  BOOLEAN NOT NULL DEFAULT false,
  "photoUrl"            TEXT,
  "bio"                 TEXT,
  "shippingAddress"     JSONB NOT NULL,
  "tshirtSize"          TEXT NOT NULL,
  "dietaryRestrictions" TEXT NOT NULL,
  "roomingPreference"   TEXT NOT NULL,
  "roommatePreference"  TEXT,
  "questions"           TEXT,
  "passportFileName"    TEXT,
  "passportMimeType"    TEXT,
  "passportData"        BYTEA,
  "ipAddress"           TEXT,
  "userAgent"           TEXT,
  "submittedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "rally_acceptances_applicationId_key" ON "rally_acceptances"("applicationId");
CREATE INDEX IF NOT EXISTS "rally_acceptances_tenantId_idx" ON "rally_acceptances"("tenantId");
