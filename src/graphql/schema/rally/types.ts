import { gql } from 'graphql-tag';

export const rallyTypeDefs = gql`
  # ============================================
  # RALLY TYPES
  # ============================================

  type Rally {
    id: ID!
    title: JSON!
    slug: String!
    description: JSON!

    # Rally Details
    startDate: DateTime!
    endDate: DateTime!
    location: JSON!
    duration: Int!
    status: RallyStatus!

    # Target Audience
    targetAudience: JSON!
    maxParticipants: Int
    currentParticipants: Int!

    # Content & Media
    heroImage: String
    heroVideo: String
    gallery: JSON
    highlights: JSON

    # Impact & Partnerships
    impactOverview: JSON!
    conservationActivities: JSON!
    rangerPartnerships: JSON!

    # Application Settings
    isRecruiting: Boolean!
    isPlaceholder: Boolean!
    applicationDeadline: DateTime

    # Financial
    cost: JSON
    depositAmount: JSON

    # SEO & Metadata
    metaTitle: JSON
    metaDescription: JSON
    featuredImage: String

    # Relations
    tenant: Tenant!
    createdBy: User!
    updatedBy: User
    applications: [RallyApplication!]!
    media: [RallyMedia!]!
    stories: [Story!]!

    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
  }

  enum RallyStatus {
    DRAFT
    UPCOMING
    ONGOING
    COMPLETED
    CANCELLED
  }

  # ============================================
  # RALLY APPLICATION TYPES
  # ============================================

  type RallyApplication {
    id: ID!
    rally: Rally!
    status: ApplicationStatus!

    # Personal Information
    firstName: String!
    lastName: String!
    email: String!
    phone: String!
    country: String!
    city: String!
    address: JSON
    birthdate: DateTime

    # Passport & Travel
    hasValidPassport: Boolean!

    # Participation Type
    isRider: Boolean!

    # Rider Information
    hasMotorcycleLicense: Boolean
    ridingExperience: JSON
    ridingVideoUrl: String

    # Medical & Emergency
    isMedicalProfessional: Boolean
    medicalCertificationType: String
    medicalConditions: JSON
    dietaryRestrictions: JSON

    # Emergency Contact
    emergencyContactFirstName: String!
    emergencyContactLastName: String!
    emergencyContactPhone: String!
    emergencyContactEmail: String!
    emergencyContactRelationship: String!

    # Social Media
    socialMediaLinks: JSON

    # Application Questions
    motivation: JSON!
    travelExperience: JSON!
    futureLocations: JSON
    howHeard: String

    # Selected Rallies
    selectedRallies: JSON!

    # Custom Responses
    customResponses: JSON!

    # Documents
    documentUrls: JSON

    # Payment Status
    depositPaid: Boolean!
    depositAmount: Float
    fullyPaid: Boolean!
    totalAmount: Float
    fundraisingStatus: JSON

    # Terms
    agreedToTerms: Boolean!
    agreedToLiability: Boolean!

    # Admin Review
    reviewedAt: DateTime
    reviewedBy: String
    reviewNotes: JSON

    # Metadata
    ipAddress: String
    userAgent: String
    source: String
    notes: JSON

    tenant: Tenant!
    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
  }

  enum ApplicationStatus {
    PENDING
    UNDER_REVIEW
    APPROVED
    WAITLIST
    REJECTED
    CANCELLED
    CONFIRMED
  }

  # ============================================
  # PARK NOMINATION TYPES
  # ============================================

  type ParkNomination {
    id: ID!

    # Park Information
    country: String!
    parkNames: JSON!
    parkWebsites: JSON

    # Park Contact
    parkContactFirstName: String!
    parkContactLastName: String!
    parkContactEmail: String!

    # Partner Organization
    partnerOrganizationName: String!
    partnerContactFirstName: String!
    partnerContactLastName: String!
    partnerContactEmail: String!
    partnerWebsite: String
    partnerAddress: JSON

    # Mission & Support
    primaryMission: JSON!
    motorcycleSupport: JSON!
    partnerLogisticsSupport: JSON

    # Additional Info
    otherInfo: JSON
    howHeard: String

    # Metadata
    ipAddress: String
    userAgent: String
    source: String

    # Status & Review
    status: NominationStatus!
    reviewedAt: DateTime
    reviewedBy: String
    reviewNotes: JSON

    tenant: Tenant!
    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
  }

  enum NominationStatus {
    PENDING
    UNDER_REVIEW
    APPROVED
    REJECTED
    SELECTED
    NOT_SELECTED
  }

  # ============================================
  # PARK PARTNERSHIP TYPES
  # ============================================

  type ParkPartnership {
    id: ID!

    # Park Information
    parkName: JSON!
    country: String!
    location: JSON!

    # Partnership Details
    establishedDate: DateTime
    partnershipType: JSON!

    # Impact
    rangersCount: Int
    areaSize: JSON
    keyChallenges: JSON

    # Contact
    contactPerson: String
    contactEmail: String
    contactPhone: String

    # Media
    photos: JSON
    videos: JSON

    # Related Rallies
    rallies: JSON

    # Status
    status: PartnershipStatus!

    tenant: Tenant!
    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
  }

  enum PartnershipStatus {
    PROPOSED
    ACTIVE
    INACTIVE
    COMPLETED
  }

  # ============================================
  # STORY TYPES
  # ============================================

  type Story {
    id: ID!
    rally: Rally

    # Story Information
    title: JSON!
    slug: String!
    excerpt: JSON
    content: JSON!
    type: StoryType!

    # Story Metadata
    author: JSON
    role: String

    # Media
    featuredImage: String
    gallery: JSON
    videoUrl: String

    # Impact Data
    beforeData: JSON
    afterData: JSON
    impactSummary: JSON

    # Relationships
    tags: JSON
    relatedRallies: JSON

    # SEO
    metaTitle: JSON
    metaDescription: JSON

    # Publishing
    status: ContentStatus!
    publishedAt: DateTime

    # Display
    featured: Boolean!
    displayOrder: Int!

    # Relations
    tenant: Tenant!
    createdBy: User!

    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
  }

  enum StoryType {
    IMPACT
    TESTIMONIAL
    RANGER_PROFILE
    RIDER_PROFILE
    FIELD_MOMENT
    BEFORE_AFTER
    UPDATE
    NEWS
  }

  # ============================================
  # RALLY MEDIA TYPES
  # ============================================

  type RallyMedia {
    id: ID!
    rally: Rally!

    # Media Information
    type: MediaTypeR!
    url: String!
    thumbnailUrl: String
    title: JSON
    description: JSON

    # Metadata
    fileSize: Int
    dimensions: JSON
    duration: Int

    # Source
    source: String
    sourceUrl: String

    # Display Settings
    isFeatured: Boolean!
    displayOrder: Int!

    # Relations
    tenant: Tenant!
    uploadedBy: User!

    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
  }

  enum MediaTypeR {
    IMAGE
    VIDEO
    DOCUMENT
    THUMBNAIL
  }

  # ============================================
  # NEWSLETTER SUBSCRIPTION TYPES
  # ============================================

  type NewsletterSubscription {
    id: ID!

    email: String!
    firstName: String
    lastName: String

    # Preferences
    interests: JSON

    # Source Tracking
    source: String

    # Status
    status: SubscriptionStatus!

    # Email Marketing
    mailchimpId: String
    sendGridId: String

    # Statistics
    openCount: Int!
    clickCount: Int!

    tenant: Tenant!
    createdAt: DateTime!
    updatedAt: DateTime!
    deletedAt: DateTime
    unsubscribedAt: DateTime
  }

  enum SubscriptionStatus {
    ACTIVE
    UNSUBSCRIBED
    BOUNCED
    PENDING
  }

  # ============================================
  # PAGINATION TYPES
  # ============================================

  type PaginatedRallies {
    rallies: [Rally!]!
    pagination: PaginationInfo!
  }

  type PaginatedApplications {
    applications: [RallyApplication!]!
    pagination: PaginationInfo!
  }

  type PaginatedNominations {
    nominations: [ParkNomination!]!
    pagination: PaginationInfo!
  }

  type PaginatedStories {
    stories: [Story!]!
    pagination: PaginationInfo!
  }

  type PaginationInfo {
    total: Int!
    totalPages: Int!
    currentPage: Int!
    perPage: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  # ============================================
  # RESPONSE TYPES
  # ============================================

  type MutationResponse {
    success: Boolean!
    message: String!
    errors: [String!]
  }

  type ApplicationResponse {
    success: Boolean!
    message: String!
    application: RallyApplication
    errors: [String!]
  }

  type NominationResponse {
    success: Boolean!
    message: String!
    nomination: ParkNomination
    errors: [String!]
  }

  # ============================================
  # ADDITIONAL ENUMS
  # ============================================

  enum PaymentStatus {
    PENDING
    PROCESSING
    COMPLETED
    FAILED
    REFUNDED
    CANCELLED
  }

  enum ContentStatus {
    DRAFT
    PUBLISHED
    ARCHIVED
    SCHEDULED
  }
`;
