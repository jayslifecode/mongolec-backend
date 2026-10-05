import { gql } from 'graphql-tag';

export const rallyMutations = gql`
  # ============================================
  # RALLY MUTATIONS
  # ============================================

  extend type Mutation {
    # Create a new rally
    createRally(data: RallyCreateInput!): Rally!

    # Update a rally
    updateRally(id: ID!, data: RallyUpdateInput!): Rally!

    # Delete a rally (soft delete)
    deleteRally(id: ID!): MutationResponse!

    # Update rally status
    changeRallyStatus(id: ID!, status: RallyStatus!): Rally!

    # Update participant count
    updateRallyParticipantCount(id: ID!, count: Int!): Rally!

    # Toggle recruiting status
    toggleRallyRecruiting(id: ID!): Rally!
  }

  input RallyCreateInput {
    tenantId: ID
    title: JSON!
    slug: String!
    description: JSON!
    startDate: DateTime!
    endDate: DateTime!
    location: JSON!
    duration: Int!
    targetAudience: JSON!
    maxParticipants: Int
    heroImage: String
    heroVideo: String
    gallery: JSON
    highlights: JSON
    impactOverview: JSON!
    conservationActivities: JSON!
    rangerPartnerships: JSON!
    isRecruiting: Boolean
    isPlaceholder: Boolean
    applicationDeadline: DateTime
    cost: JSON
    depositAmount: JSON
    metaTitle: JSON
    metaDescription: JSON
    featuredImage: String
  }

  input RallyUpdateInput {
    title: JSON
    slug: String
    description: JSON
    startDate: DateTime
    endDate: DateTime
    location: JSON
    duration: Int
    status: RallyStatus
    targetAudience: JSON
    maxParticipants: Int
    currentParticipants: Int
    heroImage: String
    heroVideo: String
    gallery: JSON
    highlights: JSON
    impactOverview: JSON
    conservationActivities: JSON
    rangerPartnerships: JSON
    isRecruiting: Boolean
    isPlaceholder: Boolean
    applicationDeadline: DateTime
    cost: JSON
    depositAmount: JSON
    metaTitle: JSON
    metaDescription: JSON
    featuredImage: String
  }

  # ============================================
  # RALLY APPLICATION MUTATIONS
  # ============================================

  extend type Mutation {
    # Submit a rally application (public)
    submitRallyApplication(data: RallyApplicationCreateInput!): ApplicationResponse!

    # Update application (admin only)
    updateRallyApplication(id: ID!, data: RallyApplicationUpdateInput!): RallyApplication!

    # Update application status (admin only)
    changeApplicationStatus(id: ID!, status: ApplicationStatus!, notes: JSON): RallyApplication!

    # Approve application (admin only)
    approveApplication(id: ID!, notes: String): RallyApplication!

    # Reject application (admin only)
    rejectApplication(id: ID!, reason: String!): RallyApplication!

    # Waitlist application (admin only)
    waitlistApplication(id: ID!, notes: String): RallyApplication!

    # Confirm application (admin only)
    confirmApplication(id: ID!): RallyApplication!

    # Cancel application (user or admin)
    cancelApplication(id: ID!, reason: String): RallyApplication!

    # Add admin review notes
    addApplicationReviewNote(id: ID!, notes: JSON!): RallyApplication!

    # Update payment status (admin only)
    changeApplicationPaymentStatus(
      id: ID!
      depositPaid: Boolean
      depositAmount: Float
      fullyPaid: Boolean
      totalAmount: Float
      fundraisingStatus: JSON
    ): RallyApplication!

    # Delete application (soft delete, admin only)
    deleteRallyApplication(id: ID!): MutationResponse!
  }

  input RallyApplicationCreateInput {
    rallyId: ID!

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
    customResponses: JSON

    # Documents
    documentUrls: JSON

    # Terms
    agreedToTerms: Boolean!
    agreedToLiability: Boolean!

    # Spam prevention (leave empty)
    honeypot: String
  }

  input RallyApplicationUpdateInput {
    # Personal Information
    firstName: String
    lastName: String
    email: String
    phone: String
    country: String
    city: String
    address: JSON
    birthdate: DateTime

    # Participation
    isRider: Boolean

    # Rider Information
    hasMotorcycleLicense: Boolean
    ridingExperience: JSON
    ridingVideoUrl: String

    # Medical
    isMedicalProfessional: Boolean
    medicalCertificationType: String
    medicalConditions: JSON
    dietaryRestrictions: JSON

    # Emergency Contact
    emergencyContactFirstName: String
    emergencyContactLastName: String
    emergencyContactPhone: String
    emergencyContactEmail: String
    emergencyContactRelationship: String

    # Social Media
    socialMediaLinks: JSON

    # Application Questions
    motivation: JSON
    travelExperience: JSON
    futureLocations: JSON
    howHeard: String

    # Selected Rallies
    selectedRallies: JSON

    # Custom Responses
    customResponses: JSON

    # Documents
    documentUrls: JSON

    # Admin Notes
    notes: JSON
  }

  # ============================================
  # PARK NOMINATION MUTATIONS
  # ============================================

  extend type Mutation {
    # Submit a park nomination (public)
    submitParkNomination(data: ParkNominationCreateInput!): NominationResponse!

    # Update nomination (admin only)
    updateParkNomination(id: ID!, data: ParkNominationUpdateInput!): ParkNomination!

    # Update nomination status (admin only)
    changeNominationStatus(id: ID!, status: NominationStatus!, notes: JSON): ParkNomination!

    # Approve nomination (admin only)
    approveNomination(id: ID!, notes: String): ParkNomination!

    # Reject nomination (admin only)
    rejectNomination(id: ID!, reason: String!): ParkNomination!

    # Select nomination for rally (admin only)
    selectNomination(id: ID!, rallyId: ID!): ParkNomination!

    # Add review notes (admin only)
    addNominationReviewNote(id: ID!, notes: JSON!): ParkNomination!

    # Delete nomination (soft delete, admin only)
    deleteParkNomination(id: ID!): MutationResponse!
  }

  input ParkNominationCreateInput {
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

    # Spam prevention (leave empty)
    honeypot: String
  }

  input ParkNominationUpdateInput {
    country: String
    parkNames: JSON
    parkWebsites: JSON
    parkContactFirstName: String
    parkContactLastName: String
    parkContactEmail: String
    partnerOrganizationName: String
    partnerContactFirstName: String
    partnerContactLastName: String
    partnerContactEmail: String
    partnerWebsite: String
    partnerAddress: JSON
    primaryMission: JSON
    motorcycleSupport: JSON
    partnerLogisticsSupport: JSON
    otherInfo: JSON
    howHeard: String
  }

  # ============================================
  # PARK PARTNERSHIP MUTATIONS
  # ============================================

  extend type Mutation {
    # Create a park partnership
    createParkPartnership(data: ParkPartnershipCreateInput!): ParkPartnership!

    # Update a park partnership
    updateParkPartnership(id: ID!, data: ParkPartnershipUpdateInput!): ParkPartnership!

    # Update partnership status
    changePartnershipStatus(id: ID!, status: PartnershipStatus!): ParkPartnership!

    # Delete park partnership (soft delete)
    deleteParkPartnership(id: ID!): MutationResponse!
  }

  input ParkPartnershipCreateInput {
    parkName: JSON!
    country: String!
    location: JSON!
    establishedDate: DateTime
    partnershipType: JSON!
    rangersCount: Int
    areaSize: JSON
    keyChallenges: JSON
    contactPerson: String
    contactEmail: String
    contactPhone: String
    photos: JSON
    videos: JSON
    rallies: JSON
  }

  input ParkPartnershipUpdateInput {
    parkName: JSON
    country: String
    location: JSON
    establishedDate: DateTime
    partnershipType: JSON
    rangersCount: Int
    areaSize: JSON
    keyChallenges: JSON
    contactPerson: String
    contactEmail: String
    contactPhone: String
    photos: JSON
    videos: JSON
    rallies: JSON
  }

  # ============================================
  # STORY MUTATIONS
  # ============================================

  extend type Mutation {
    # Create a story
    createStory(data: StoryCreateInput!): Story!

    # Update a story
    updateStory(id: ID!, data: StoryUpdateInput!): Story!

    # Publish story
    publishStory(id: ID!): Story!

    # Unpublish story
    unpublishStory(id: ID!): Story!

    # Toggle featured status
    toggleStoryFeatured(id: ID!): Story!

    # Update display order
    updateStoryOrder(id: ID!, order: Int!): Story!

    # Delete story (soft delete)
    deleteStory(id: ID!): MutationResponse!
  }

  input StoryCreateInput {
    rallyId: ID
    title: JSON!
    slug: String!
    excerpt: JSON
    content: JSON!
    type: StoryType!
    author: JSON
    role: String
    featuredImage: String
    gallery: JSON
    videoUrl: String
    beforeData: JSON
    afterData: JSON
    impactSummary: JSON
    tags: JSON
    relatedRallies: JSON
    metaTitle: JSON
    metaDescription: JSON
    featured: Boolean
    displayOrder: Int
  }

  input StoryUpdateInput {
    rallyId: ID
    title: JSON
    slug: String
    excerpt: JSON
    content: JSON
    type: StoryType
    author: JSON
    role: String
    featuredImage: String
    gallery: JSON
    videoUrl: String
    beforeData: JSON
    afterData: JSON
    impactSummary: JSON
    tags: JSON
    relatedRallies: JSON
    metaTitle: JSON
    metaDescription: JSON
    status: ContentStatus
    featured: Boolean
    displayOrder: Int
  }

  # ============================================
  # RALLY MEDIA MUTATIONS
  # ============================================

  extend type Mutation {
    # Create rally media
    createRallyMedia(data: RallyMediaCreateInput!): RallyMedia!

    # Upload rally media
    uploadRallyMedia(data: RallyMediaCreateInput!): RallyMedia!

    # Update rally media
    updateRallyMedia(id: ID!, data: RallyMediaUpdateInput!): RallyMedia!

    # Reorder rally media
    reorderRallyMedia(rallyId: ID!, mediaIds: [ID!]!): [RallyMedia!]!

    # Toggle featured status
    toggleMediaFeatured(id: ID!): RallyMedia!

    # Update display order
    updateMediaOrder(id: ID!, order: Int!): RallyMedia!

    # Delete rally media (soft delete)
    deleteRallyMedia(id: ID!): MutationResponse!
  }

  input RallyMediaCreateInput {
    rallyId: ID!
    type: MediaTypeR!
    url: String!
    thumbnailUrl: String
    title: JSON
    description: JSON
    fileSize: Int
    dimensions: JSON
    duration: Int
    source: String
    sourceUrl: String
    isFeatured: Boolean
    displayOrder: Int
  }

  input RallyMediaUpdateInput {
    type: MediaTypeR
    url: String
    thumbnailUrl: String
    title: JSON
    description: JSON
    fileSize: Int
    dimensions: JSON
    duration: Int
    source: String
    sourceUrl: String
    isFeatured: Boolean
    displayOrder: Int
  }

  # ============================================
  # NEWSLETTER MUTATIONS
  # ============================================

  extend type Mutation {
    # Subscribe to newsletter (public)
    subscribeToNewsletter(data: NewsletterSubscribeInput!): MutationResponse!

    # Unsubscribe from newsletter (public)
    unsubscribeFromNewsletter(email: String!): MutationResponse!

    # Update subscription (user)
    updateNewsletterSubscription(
      email: String!
      data: SubscriptionUpdateInput!
    ): NewsletterSubscription!

    # Update subscription status (admin)
    changeSubscriptionStatus(email: String!, status: SubscriptionStatus!): NewsletterSubscription!

    # Record email open (tracking)
    recordEmailOpen(email: String!): NewsletterSubscription!

    # Record email click (tracking)
    recordEmailClick(email: String!): NewsletterSubscription!

    # Delete subscription (soft delete, admin only)
    deleteNewsletterSubscription(email: String!): MutationResponse!
  }

  input NewsletterSubscribeInput {
    email: String!
    firstName: String
    lastName: String
    interests: JSON
    source: String

    # Spam prevention (leave empty)
    honeypot: String
  }

  input SubscriptionUpdateInput {
    firstName: String
    lastName: String
    interests: JSON
  }
`;
