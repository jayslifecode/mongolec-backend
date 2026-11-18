import gql from 'graphql-tag';

/**
 * Acceptance letter (Rally for Rangers, round 4; replaces the Jotform).
 * Approving an application creates a private link token. The rider opens
 * /acceptance/<token> on the public site, which reads `getAcceptanceInvite` and submits
 * `submitAcceptance`. Admins see the answers on the application; the passport copy is only
 * returned by the admin-only `getAcceptancePassport`.
 */
export const acceptanceSchema = gql`
  type AcceptanceInvite {
    firstName: String!
    lastName: String!
    email: String!
    rallyTitle: String!
    rallySlug: String!
    rallyStartDate: DateTime
    rallyEndDate: DateTime
    rallyLocation: String
    # {currency, minimumContribution, deposit, nonRefundable, finalPaymentDue}
    terms: JSON
    alreadySubmitted: Boolean!
    # We already hold a photo or bio for this rider, so "use my past photo and bio" is offered.
    hasPastProfile: Boolean!
    pastPhoto: String
  }

  type RallyAcceptance {
    id: ID!
    firstName: String!
    lastName: String!
    email: String!
    agreedToCommitment: Boolean!
    agreedToLiability: Boolean!
    usePastPhotoAndBio: Boolean!
    photoUrl: String
    bio: String
    shippingAddress: JSON!
    tshirtSize: String!
    dietaryRestrictions: String!
    roomingPreference: String!
    roommatePreference: String
    questions: String
    hasPassport: Boolean!
    passportFileName: String
    submittedAt: DateTime!
  }

  type AcceptanceFile {
    fileName: String!
    mimeType: String!
    base64: String!
  }

  type SubmitAcceptanceResponse {
    success: Boolean!
    message: String!
  }

  input AcceptanceFileInput {
    fileName: String!
    mimeType: String!
    base64: String!
  }

  input AcceptanceAddressInput {
    street: String!
    street2: String
    city: String!
    state: String
    postalCode: String
    country: String!
  }

  input SubmitAcceptanceInput {
    token: String!
    firstName: String!
    lastName: String!
    email: String!
    agreedToCommitment: Boolean!
    agreedToLiability: Boolean!
    usePastPhotoAndBio: Boolean!
    photo: AcceptanceFileInput
    bio: String
    shippingAddress: AcceptanceAddressInput!
    tshirtSize: String!
    dietaryRestrictions: String!
    roomingPreference: String!
    roommatePreference: String
    passport: AcceptanceFileInput
    questions: String
    honeypot: String
  }

  extend type RallyApplication {
    # Admin-only (application queries require application access)
    acceptanceUrl: String
    acceptance: RallyAcceptance
  }

  extend type Query {
    # Public: the rider's private link
    getAcceptanceInvite(token: String!): AcceptanceInvite
    # Admin: download the passport copy
    getAcceptancePassport(applicationId: ID!): AcceptanceFile
  }

  extend type Mutation {
    # Public: submit the acceptance letter from the private link
    submitAcceptance(input: SubmitAcceptanceInput!): SubmitAcceptanceResponse!
    # Admin: make sure an approved application has a link (returns the full URL)
    ensureAcceptanceLink(applicationId: ID!): String!
  }
`;
