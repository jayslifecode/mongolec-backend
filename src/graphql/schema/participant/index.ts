import { gql } from 'graphql-tag';

export const participantSchema = gql`
  enum RiderTier {
    RIDER
    RETURNING
    VETERAN
    LEGEND
  }

  type ParticipantRallyLink {
    rally: Rally!
    year: Int
    role: String
  }

  type RallyParticipantLink {
    participant: Participant!
    year: Int
    role: String
  }

  type Participant {
    id: ID!
    firstName: String!
    lastName: String!
    slug: String!
    honoraryTitle: String
    photo: String
    country: String!
    bio: String
    isActive: Boolean!
    displayOrder: Int!
    rallyYears: [Int!]!
    rallyCount: Int!
    tier: RiderTier!
    rallies: [ParticipantRallyLink!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  extend type Rally {
    participants: [RallyParticipantLink!]!
    participantCount: Int!
  }

  type PaginatedParticipants {
    participants: [Participant!]!
    pagination: PaginationInfo!
  }

  extend type Query {
    getParticipants(
      search: String
      tier: RiderTier
      limit: Int
      page: Int
      isActive: Boolean
    ): PaginatedParticipants!
    getParticipant(slug: String, id: ID): Participant
  }

  extend type Mutation {
    createParticipant(input: CreateParticipantInput!): Participant!
    updateParticipant(id: ID!, input: UpdateParticipantInput!): Participant!
    deleteParticipant(id: ID!): Boolean!
  }

  input CreateParticipantInput {
    firstName: String!
    lastName: String!
    photo: String
    country: String!
    bio: String
    displayOrder: Int
    isActive: Boolean
    slug: String
    honoraryTitle: String
    rallyIds: [ID!]
  }

  input UpdateParticipantInput {
    firstName: String
    lastName: String
    photo: String
    country: String
    bio: String
    displayOrder: Int
    isActive: Boolean
    slug: String
    honoraryTitle: String
    rallyIds: [ID!]
  }
`;
