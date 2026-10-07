import { GraphQLScalarType, Kind } from 'graphql';

// Import queries
import { authQueries } from './queries/auth';
import { userQueries } from './queries/user';
import { tenantQueries } from './queries/tenant';
import { newsQueries } from './queries/news';
import { merchQueries } from './queries/merch';
import { orderQueries } from './queries/order';
import { discountQueries } from './queries/discount';
import { contentQueries } from './queries/content';
import { rallyQueries } from './queries/rally';
import { applicationQueries } from './queries/application';
import { nominationQueries } from './queries/nomination';
import { storyQueries } from './queries/story';
import { mediaQueries } from './queries/media';
import { partnershipQueries } from './queries/partnership';
import { newsletterQueries } from './queries/newsletter';
import { teamQueries } from './queries/team';
import { rangerQueries } from './queries/ranger';
import { participantQueries } from './queries/participant';
import { tierFor } from '@/config/rider-tiers';

// Import mutations
import { authMutations } from './mutations/auth';
import { userMutations } from './mutations/user';
import { newsMutations } from './mutations/news';
import { merchMutations } from './mutations/merch';
import { orderMutations } from './mutations/order';
import { discountMutations } from './mutations/discount';
import { orderExportMutations } from './mutations/order-export';
import { contentMutations } from './mutations/content';
import { tenantMutations } from './mutations/tenant';
import { uploadResolvers } from './mutations/upload';
import { rallyMutations } from './mutations/rally';
import { applicationMutations } from './mutations/application';
import { nominationMutations } from './mutations/nomination';
import { storyMutations } from './mutations/story';
import { mediaMutations } from './mutations/media';
import { partnershipMutations } from './mutations/partnership';
import { newsletterMutations } from './mutations/newsletter';
import { teamMutations } from './mutations/team';
import { rangerMutations } from './mutations/ranger';
import { participantMutations } from './mutations/participant';
import { paymentQueries } from './queries/payment';
import { paymentMutations } from './mutations/payment';

/**
 * Custom scalar resolvers
 */
const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'DateTime custom scalar type',
  serialize(value: any) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  },
  parseValue(value: any) {
    return new Date(value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    return null;
  },
});

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  serialize(value: any) {
    return value;
  },
  parseValue(value: any) {
    return value;
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.OBJECT || ast.kind === Kind.STRING) {
      return ast;
    }
    return null;
  },
});

/**
 * Type resolvers
 */
const Tenant = {
  // Map database status field to GraphQL isActive field
  isActive: (parent: any) => parent.status === 'ACTIVE',
};

const Rally = {
  // Old records may have null before @default(0) was added
  currentParticipants: (parent: any) => parent.currentParticipants ?? 0,

  // Participant <-> Rally link fields. Lazily fetched (not eager-included on every rally
  // query) since they're only needed on a single rally's detail page.
  participants: async (parent: any, _args: any, context: any) => {
    const links = await context.prisma.participantRally.findMany({
      where: { rallyId: parent.id, participant: { deletedAt: null } },
      include: { participant: { include: { rallies: true } } },
    });
    return links.map((l: any) => ({ participant: l.participant, year: l.year, role: l.role }));
  },
  participantCount: (parent: any, _args: any, context: any) =>
    context.prisma.participantRally.count({
      where: { rallyId: parent.id, participant: { deletedAt: null } },
    }),
};

/**
 * Participant field resolvers: `rallyCount`/`tier` are computed (never stored), and
 * `rallyYears`/`rallies` derive from the `rallies` relation. Query resolvers eager-include
 * `rallies.rally` (see `queries/participant.ts`) so this never issues a per-participant query
 * in list results; it only falls back to a DB read when a Participant arrives without that
 * relation already loaded (e.g. nested under `Rally.participants`).
 */
const Participant = {
  rallyCount: (parent: any) => parent._count?.rallies ?? parent.rallies?.length ?? 0,
  tier: (parent: any) => tierFor(parent._count?.rallies ?? parent.rallies?.length ?? 0),
  rallyYears: (parent: any) =>
    (parent.rallies ?? [])
      .map((r: any) => r.year)
      .filter((y: unknown): y is number => y !== null && y !== undefined),
  rallies: async (parent: any, _args: any, context: any) => {
    let links = parent.rallies;
    // Fallback: only hit when the relation wasn't eager-loaded by the caller.
    if (!links || (links.length > 0 && links[0].rally === undefined)) {
      links = await context.prisma.participantRally.findMany({
        where: { participantId: parent.id },
        include: {
          rally: {
            select: {
              id: true,
              slug: true,
              title: true,
              startDate: true,
              endDate: true,
              heroImage: true,
              status: true,
              location: true,
              stories: { select: { slug: true, status: true } },
            },
          },
        },
      });
    }
    const isAnonymous = !context.user;
    return links.map((pr: any) => ({
      year: pr.year,
      role: pr.role,
      rally: {
        ...pr.rally,
        stories: isAnonymous
          ? (pr.rally.stories ?? []).filter((s: any) => s.status === 'PUBLISHED')
          : pr.rally.stories,
      },
    }));
  },
};

const MerchOrder = {
  // Payments for an order (admin visibility). Raw QPay payloads are never exposed here.
  payments: (parent: any, _args: any, context: any) =>
    context.prisma.payment.findMany({
      where: { orderId: parent.id },
      orderBy: { createdAt: 'desc' },
    }),
};

/**
 * Combined Resolvers
 * Merges all domain resolvers with scalars and base resolvers
 */
export const resolvers = {
  // Custom Scalars
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  // Type Resolvers
  Tenant,
  Rally,
  Participant,
  MerchOrder,

  // Root Query
  Query: {
    // Health check
    health: () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    }),
    hello: () => 'Hello from GraphQL!',

    // Domain queries
    ...authQueries,
    ...userQueries,
    ...tenantQueries,
    ...newsQueries,
    ...merchQueries,
    ...orderQueries,
    ...discountQueries,
    ...contentQueries,
    ...rallyQueries,
    ...applicationQueries,
    ...nominationQueries,
    ...storyQueries,
    ...mediaQueries,
    ...partnershipQueries,
    ...newsletterQueries,
    ...teamQueries,
    ...rangerQueries,
    ...participantQueries,
    ...paymentQueries,
  },

  // Root Mutation
  Mutation: {
    // Domain mutations
    ...authMutations,
    ...userMutations,
    ...tenantMutations,
    ...newsMutations,
    ...merchMutations, // Includes variant mutations
    ...orderMutations, // Guest createMerchOrder + admin status update
    ...discountMutations,
    ...orderExportMutations,
    ...contentMutations,
    ...uploadResolvers.Mutation,
    ...rallyMutations,
    ...applicationMutations,
    ...nominationMutations,
    ...storyMutations,
    ...mediaMutations,
    ...partnershipMutations,
    ...newsletterMutations,
    ...teamMutations,
    ...rangerMutations,
    ...participantMutations,
    ...paymentMutations,
  },
};

export default resolvers;
