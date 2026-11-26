import { gql } from 'graphql-tag';

export const rallyQueries = gql`
  # ============================================
  # RALLY QUERIES
  # ============================================

  extend type Query {
    # Get all rallies with pagination and filters
    getRallies(
      page: Int
      limit: Int
      status: RallyStatus
      search: String
      orderBy: String
      orderDirection: String
      tenantId: ID
      isFeatured: Boolean
    ): PaginatedRallies!

    # The rally featured on the website's home hero (never a draft), or null
    getFeaturedRally: Rally

    # Get single rally by slug or ID
    getRally(slug: String, id: ID): Rally

    # Get upcoming rallies
    getUpcomingRallies(page: Int, limit: Int): PaginatedRallies!

    # Get past rallies
    getPastRallies(page: Int, limit: Int): PaginatedRallies!

    # Get recruiting rallies (accepting applications)
    getRecruitingRallies: [Rally!]!
  }

  # ============================================
  # RALLY APPLICATION QUERIES
  # ============================================

  extend type Query {
    # Get all applications with filters
    getApplications(
      page: Int
      limit: Int
      status: ApplicationStatus
      rallyId: ID
      search: String
      orderBy: String
      orderDirection: String
    ): PaginatedApplications!

    # Get single application by ID
    getApplication(id: ID!): RallyApplication

    # Get pending applications
    getPendingApplications(page: Int, limit: Int): PaginatedApplications!

    # Get approved applications
    getApprovedApplications(page: Int, limit: Int, rallyId: ID): PaginatedApplications!

    # Get application stats
    getApplicationStats(rallyId: ID): ApplicationStats

    # Check if email has already applied to a rally
    checkHasApplied(rallyId: ID!, email: String!): Boolean!
  }

  # Application Statistics
  type ApplicationStats {
    totalApplications: Int!
    pendingApplications: Int!
    approvedApplications: Int!
    rejectedApplications: Int!
    waitlistedApplications: Int!
    confirmedApplications: Int!
    riderCount: Int!
    supporterCount: Int!
    totalRaising: Float! # Total fundraising amount
  }

  # ============================================
  # PARK NOMINATION QUERIES
  # ============================================

  extend type Query {
    # Get all nominations with filters
    getNominations(
      page: Int
      limit: Int
      status: NominationStatus
      country: String
      orderBy: String
      orderDirection: String
    ): PaginatedNominations!

    # Get single nomination by ID
    getNomination(id: ID!): ParkNomination

    # Get pending nominations
    getPendingNominations(page: Int, limit: Int): PaginatedNominations!

    # Get approved nominations
    getApprovedNominations(page: Int, limit: Int, rallyId: ID): PaginatedNominations!

    # Get nominations by country
    getNominationsByCountry(country: String!, page: Int, limit: Int): PaginatedNominations!

    # Get nomination stats
    getNominationStats: NominationStats

    # Check if email has already nominated a park for a rally
    checkHasNominated(rallyId: ID!, email: String!): Boolean!
  }

  type NominationStats {
    total: Int!
    pending: Int!
    underReview: Int!
    approved: Int!
    rejected: Int!
    selected: Int!
    notSelected: Int!
  }

  # ============================================
  # PARK PARTNERSHIP QUERIES
  # ============================================

  extend type Query {
    # Get all park partnerships
    getParkPartnerships(
      page: Int
      limit: Int
      status: PartnershipStatus
      country: String
    ): [ParkPartnership!]!

    # Get single partnership by ID
    getParkPartnership(id: ID!): ParkPartnership

    # Get active partnerships
    getActivePartnerships: [ParkPartnership!]!

    # Get partnerships by country
    getPartnershipsByCountry(country: String!): [ParkPartnership!]!

    # Get partnership statistics
    getPartnershipStats(rallyId: ID): PartnershipStats
  }

  type PartnershipStats {
    totalPartnerships: Int!
    activePartnerships: Int!
    prospectivePartnerships: Int!
    confirmedPartnerships: Int!
    uniqueCountryCount: Int!
  }

  # ============================================
  # STORY QUERIES
  # ============================================

  extend type Query {
    # Get all stories with pagination and filters
    getStories(
      page: Int
      limit: Int
      type: StoryType
      status: ContentStatus
      featured: Boolean
      rallyId: ID
      search: String
      orderBy: String
      orderDirection: String
    ): PaginatedStories!

    # Get single story by slug or ID
    getStory(slug: String, id: ID): Story

    # Get published stories (public)
    getPublishedStories(page: Int, limit: Int, type: StoryType, rallyId: ID): PaginatedStories!

    # Get featured stories
    getFeaturedStories(limit: Int): [Story!]!

    # Get stories by type
    getStoriesByType(type: StoryType!, page: Int, limit: Int): PaginatedStories!

    # Get ranger profiles
    getRangerProfiles: [Story!]!

    # Get rider profiles
    getRiderProfiles: [Story!]!

    # Get impact stories
    getImpactStories(page: Int, limit: Int): PaginatedStories!

    # Get draft stories (admin only)
    getDraftStories(page: Int, limit: Int): PaginatedStories!

    # Get story statistics (admin only)
    getStoryStats(rallyId: ID): StoryStats

    # Get related stories
    getRelatedStories(storyId: ID!): [Story!]!
  }

  type StoryStats {
    totalStories: Int!
    publishedStories: Int!
    draftStories: Int!
    featuredStories: Int!
    impactStories: Int!
    riderStories: Int!
    rallyStories: Int!
  }

  # ============================================
  # RALLY MEDIA QUERIES
  # ============================================

  extend type Query {
    # Get all media for a rally
    getRallyMedia(rallyId: ID!): [RallyMedia!]!

    # Get single media by ID
    getMedia(id: ID!): RallyMedia

    # Get featured media for a rally
    getFeaturedRallyMedia(rallyId: ID!): [RallyMedia!]!

    # Get media by type
    getRallyMediaByType(rallyId: ID!, type: MediaTypeR!): [RallyMedia!]!

    # Get single media item by ID
    getRallyMediaItem(id: ID!): RallyMedia
  }

  # ============================================
  # NEWSLETTER QUERIES
  # ============================================

  type PaginatedNewsletterSubscriptions {
    subscriptions: [NewsletterSubscription!]!
    pagination: PaginationInfo!
  }

  extend type Query {
    # Get all newsletter subscriptions
    getNewsletterSubscriptions(
      page: Int
      limit: Int
      status: SubscriptionStatus
      search: String
    ): PaginatedNewsletterSubscriptions!

    # Get subscription by email
    getNewsletterSubscription(email: String!): NewsletterSubscription

    # Check if email is subscribed
    checkIsSubscribed(email: String!): Boolean!

    # Get subscriber stats
    getSubscriberStats: SubscriberStats

    # Get newsletter statistics
    getNewsletterStats: NewsletterStats
  }

  type NewsletterStats {
    totalSubscriptions: Int!
    activeSubscriptions: Int!
    unsubscribed: Int!
    bounced: Int!
  }

  type SubscriberStats {
    totalSubscribers: Int!
    activeSubscribers: Int!
    unsubscribed: Int!
    bounced: Int!
    averageOpenRate: Float!
    averageClickRate: Float!
  }
`;
