-- Create missing enum types (errors on duplicate are caught by the runner)
CREATE TYPE "RallyStatus" AS ENUM ('DRAFT','UPCOMING','ONGOING','COMPLETED','CANCELLED');
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING','UNDER_REVIEW','APPROVED','WAITLIST','REJECTED','CANCELLED','CONFIRMED');
CREATE TYPE "NominationStatus" AS ENUM ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','SELECTED','NOT_SELECTED');
CREATE TYPE "PartnershipStatus" AS ENUM ('PROPOSED','ACTIVE','INACTIVE','COMPLETED');
CREATE TYPE "StoryType" AS ENUM ('IMPACT','TESTIMONIAL','RANGER_PROFILE','RIDER_PROFILE','FIELD_MOMENT','BEFORE_AFTER','UPDATE','NEWS');
CREATE TYPE "MediaTypeR" AS ENUM ('IMAGE','VIDEO','DOCUMENT','THUMBNAIL');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE','UNSUBSCRIBED','BOUNCED','PENDING');
CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW','READ','REPLIED','ARCHIVED','SPAM');

-- rallies
CREATE TABLE IF NOT EXISTS rallies (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 JSONB NOT NULL,
  slug                  TEXT NOT NULL,
  description           JSONB NOT NULL,
  "startDate"           TIMESTAMP(3) NOT NULL,
  "endDate"             TIMESTAMP(3) NOT NULL,
  location              JSONB NOT NULL,
  duration              INTEGER NOT NULL,
  status                "RallyStatus" NOT NULL DEFAULT 'DRAFT',
  "targetAudience"      JSONB NOT NULL DEFAULT '[]',
  "maxParticipants"     INTEGER,
  "currentParticipants" INTEGER NOT NULL DEFAULT 0,
  "heroImage"           TEXT,
  "heroVideo"           TEXT,
  gallery               JSONB,
  highlights            JSONB,
  "impactOverview"      JSONB NOT NULL DEFAULT '{}',
  "conservationActivities" JSONB NOT NULL DEFAULT '[]',
  "rangerPartnerships"  JSONB NOT NULL DEFAULT '{}',
  "isRecruiting"        BOOLEAN NOT NULL DEFAULT true,
  "applicationDeadline" TIMESTAMP(3),
  cost                  JSONB,
  "depositAmount"       JSONB,
  "metaTitle"           JSONB,
  "metaDescription"     JSONB,
  "featuredImage"       TEXT,
  "tenantId"            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdById"         TEXT NOT NULL REFERENCES users(id),
  "updatedById"         TEXT REFERENCES users(id),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"           TIMESTAMP(3),
  UNIQUE (slug, "tenantId")
);

-- stories
CREATE TABLE IF NOT EXISTS stories (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "rallyId"         TEXT REFERENCES rallies(id),
  title             JSONB NOT NULL,
  slug              TEXT NOT NULL,
  excerpt           JSONB,
  content           JSONB NOT NULL,
  type              "StoryType" NOT NULL DEFAULT 'IMPACT',
  author            JSONB,
  role              TEXT,
  "featuredImage"   TEXT,
  gallery           JSONB,
  "videoUrl"        TEXT,
  "beforeData"      JSONB,
  "afterData"       JSONB,
  "impactSummary"   JSONB,
  tags              JSONB,
  "relatedRallies"  JSONB,
  "metaTitle"       JSONB,
  "metaDescription" JSONB,
  status            "ContentStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt"     TIMESTAMP(3),
  featured          BOOLEAN NOT NULL DEFAULT false,
  "displayOrder"    INTEGER NOT NULL DEFAULT 0,
  "tenantId"        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdById"     TEXT NOT NULL REFERENCES users(id),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"       TIMESTAMP(3),
  UNIQUE (slug, "tenantId")
);

-- rally_applications
CREATE TABLE IF NOT EXISTS rally_applications (
  id                              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "rallyId"                       TEXT NOT NULL REFERENCES rallies(id),
  status                          "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "firstName"                     TEXT NOT NULL,
  "lastName"                      TEXT NOT NULL,
  email                           TEXT NOT NULL,
  phone                           TEXT NOT NULL,
  country                         TEXT NOT NULL,
  city                            TEXT NOT NULL,
  address                         JSONB,
  birthdate                       TIMESTAMP(3),
  "hasValidPassport"              BOOLEAN NOT NULL DEFAULT false,
  "isRider"                       BOOLEAN NOT NULL DEFAULT true,
  "hasMotorcycleLicense"          BOOLEAN,
  "ridingExperience"              JSONB,
  "ridingVideoUrl"                TEXT,
  "isMedicalProfessional"         BOOLEAN,
  "medicalCertificationType"      TEXT,
  "medicalConditions"             JSONB,
  "dietaryRestrictions"           JSONB,
  "emergencyContactFirstName"     TEXT NOT NULL DEFAULT '',
  "emergencyContactLastName"      TEXT NOT NULL DEFAULT '',
  "emergencyContactPhone"         TEXT NOT NULL DEFAULT '',
  "emergencyContactEmail"         TEXT NOT NULL DEFAULT '',
  "emergencyContactRelationship"  TEXT NOT NULL DEFAULT '',
  "socialMediaLinks"              JSONB,
  motivation                      JSONB NOT NULL DEFAULT '{}',
  "travelExperience"              JSONB NOT NULL DEFAULT '{}',
  "futureLocations"               JSONB,
  "howHeard"                      TEXT,
  "selectedRallies"               JSONB NOT NULL DEFAULT '[]',
  "customResponses"               JSONB NOT NULL DEFAULT '{}',
  "documentUrls"                  JSONB,
  "depositPaid"                   BOOLEAN NOT NULL DEFAULT false,
  "depositAmount"                 DOUBLE PRECISION,
  "fullyPaid"                     BOOLEAN NOT NULL DEFAULT false,
  "totalAmount"                   DOUBLE PRECISION,
  "fundraisingStatus"             JSONB,
  "agreedToTerms"                 BOOLEAN NOT NULL DEFAULT false,
  "agreedToLiability"             BOOLEAN NOT NULL DEFAULT false,
  "reviewedAt"                    TIMESTAMP(3),
  "reviewedBy"                    TEXT,
  "reviewNotes"                   JSONB,
  "ipAddress"                     TEXT,
  "userAgent"                     TEXT,
  source                          TEXT,
  notes                           JSONB,
  "tenantId"                      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"                     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"                     TIMESTAMP(3)
);

-- park_partnerships
CREATE TABLE IF NOT EXISTS park_partnerships (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "parkName"          JSONB NOT NULL,
  country             TEXT NOT NULL,
  location            JSONB NOT NULL,
  "establishedDate"   TIMESTAMP(3),
  "partnershipType"   JSONB NOT NULL DEFAULT '{}',
  "rangersCount"      INTEGER,
  "areaSize"          JSONB,
  "keyChallenges"     JSONB,
  "contactPerson"     TEXT,
  "contactEmail"      TEXT,
  "contactPhone"      TEXT,
  photos              JSONB,
  videos              JSONB,
  rallies             JSONB,
  status              "PartnershipStatus" NOT NULL DEFAULT 'PROPOSED',
  "tenantId"          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"         TIMESTAMP(3)
);

-- rally_media
CREATE TABLE IF NOT EXISTS rally_media (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "rallyId"       TEXT NOT NULL REFERENCES rallies(id) ON DELETE CASCADE,
  type            "MediaTypeR" NOT NULL,
  url             TEXT NOT NULL,
  "thumbnailUrl"  TEXT,
  title           JSONB,
  description     JSONB,
  "fileSize"      INTEGER,
  dimensions      JSONB,
  duration        INTEGER,
  source          TEXT,
  "sourceUrl"     TEXT,
  "isFeatured"    BOOLEAN NOT NULL DEFAULT false,
  "displayOrder"  INTEGER NOT NULL DEFAULT 0,
  "tenantId"      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "uploadedById"  TEXT NOT NULL REFERENCES users(id),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"     TIMESTAMP(3)
);

-- newsletter_subscriptions
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  "firstName"     TEXT,
  "lastName"      TEXT,
  interests       JSONB,
  source          TEXT,
  status          "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "mailchimpId"   TEXT,
  "sendGridId"    TEXT,
  "openCount"     INTEGER NOT NULL DEFAULT 0,
  "clickCount"    INTEGER NOT NULL DEFAULT 0,
  "tenantId"      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"     TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3)
);

-- park_nominations
CREATE TABLE IF NOT EXISTS park_nominations (
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  country                     TEXT NOT NULL,
  "parkNames"                 JSONB NOT NULL,
  "parkWebsites"              JSONB,
  "parkContactFirstName"      TEXT NOT NULL DEFAULT '',
  "parkContactLastName"       TEXT NOT NULL DEFAULT '',
  "parkContactEmail"          TEXT NOT NULL DEFAULT '',
  "partnerOrganizationName"   TEXT NOT NULL DEFAULT '',
  "partnerContactFirstName"   TEXT NOT NULL DEFAULT '',
  "partnerContactLastName"    TEXT NOT NULL DEFAULT '',
  "partnerContactEmail"       TEXT NOT NULL DEFAULT '',
  "partnerWebsite"            TEXT,
  "partnerAddress"            JSONB,
  "primaryMission"            JSONB NOT NULL DEFAULT '{}',
  "motorcycleSupport"         JSONB NOT NULL DEFAULT '{}',
  "partnerLogisticsSupport"   JSONB,
  "otherInfo"                 JSONB,
  "howHeard"                  TEXT,
  "ipAddress"                 TEXT,
  "userAgent"                 TEXT,
  source                      TEXT,
  status                      "NominationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedAt"                TIMESTAMP(3),
  "reviewedBy"                TEXT,
  "reviewNotes"               JSONB,
  "tenantId"                  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"                 TIMESTAMP(3)
);

-- contact_messages
CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "readAt"    TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  "tenantId"  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMP(3)
);

-- team_members
CREATE TABLE IF NOT EXISTS team_members (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,
  bio             TEXT,
  photo           TEXT,
  email           TEXT,
  "linkedinUrl"   TEXT,
  "twitterUrl"    TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "displayOrder"  INTEGER NOT NULL DEFAULT 0,
  "tenantId"      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deletedAt"     TIMESTAMP(3)
);

-- 2026-10-06: placeholder rallies ("To be announced soon" cards)
ALTER TABLE rallies ADD COLUMN IF NOT EXISTS "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;
