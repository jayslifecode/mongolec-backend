import gql from 'graphql-tag';
import { authSchema } from './auth';
import { newsSchema } from './news';
import { merchSchema } from './merch';
import { orderSchema } from './order';
import { paymentSchema } from './payment';
import { contentSchema } from './content';
import { uploadTypeDefs } from './upload';
import { rallySchema } from './rally';
import { teamSchema } from './team';
import { rangerSchema } from './ranger';
import { participantSchema } from './participant';

/**
 * Base Schema
 * Scalars, base Query/Mutation types, and health check
 */
const baseSchema = gql`
  scalar DateTime
  scalar JSON

  # ============================================
  # Health Check
  # ============================================

  type Health {
    status: String!
    timestamp: String!
    version: String!
  }

  # ============================================
  # Base Query & Mutation Types
  # ============================================

  type Query {
    health: Health!
    hello: String!
  }

  type Mutation {
    _empty: String
  }
`;

/**
 * Combined Type Definitions
 * Merges all domain schemas with base schema
 */
export const typeDefs = [
  baseSchema,
  authSchema,
  newsSchema,
  merchSchema,
  orderSchema,
  paymentSchema,
  contentSchema,
  uploadTypeDefs,
  rallySchema,
  teamSchema,
  rangerSchema,
  participantSchema,
];

export default typeDefs;
