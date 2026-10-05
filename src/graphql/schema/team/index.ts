import { gql } from 'graphql-tag';

export const teamSchema = gql`
  type TeamMember {
    id: ID!
    tenantId: String!
    name: String!
    role: String!
    bio: String
    photo: String
    email: String
    linkedinUrl: String
    twitterUrl: String
    displayOrder: Int!
    isActive: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  enum ContactMessageStatus {
    NEW
    READ
    REPLIED
  }

  type ContactMessage {
    id: ID!
    tenantId: String!
    name: String!
    email: String!
    subject: String!
    message: String!
    status: ContactMessageStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  extend type Query {
    getTeamMembers: [TeamMember!]!
    getContactMessages(
      page: Int
      limit: Int
      status: ContactMessageStatus
    ): PaginatedContactMessages!
    getContactMessage(id: ID!): ContactMessage
  }

  type PaginatedContactMessages {
    items: [ContactMessage!]!
    total: Int!
    page: Int!
    limit: Int!
  }

  extend type Mutation {
    createTeamMember(data: TeamMemberCreateInput!): TeamMember!
    updateTeamMember(id: ID!, data: TeamMemberUpdateInput!): TeamMember!
    deleteTeamMember(id: ID!): MutationResponse!
    reorderTeamMembers(ids: [ID!]!): [TeamMember!]!

    submitContactMessage(data: ContactMessageInput!): MutationResponse!
    changeContactMessageStatus(id: ID!, status: ContactMessageStatus!): ContactMessage!
  }

  input TeamMemberCreateInput {
    name: String!
    role: String!
    bio: String
    photo: String
    email: String
    linkedinUrl: String
    twitterUrl: String
    displayOrder: Int
    isActive: Boolean
    tenantId: String
  }

  input TeamMemberUpdateInput {
    name: String
    role: String
    bio: String
    photo: String
    email: String
    linkedinUrl: String
    twitterUrl: String
    displayOrder: Int
    isActive: Boolean
  }

  input ContactMessageInput {
    name: String!
    email: String!
    subject: String!
    message: String!

    # Spam prevention (leave empty)
    honeypot: String
  }
`;
