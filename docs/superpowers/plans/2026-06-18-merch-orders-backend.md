# Merch Orders Backend (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guest-checkout order feature to `mongolec-backend` — a `createMerchOrder` GraphQL mutation that persists real orders (validating stock and recomputing totals server-side), plus admin queries/mutation to view and update orders.

**Architecture:** New `MerchOrder` + `MerchOrderItem` Prisma models. A guest-accessible `createMerchOrder` resolver (no auth decorator) does all validation and inventory decrement inside one interactive `$transaction`, snapshotting product name/image/price onto each order item. Admin-only `getMerchOrders` / `getMerchOrderById` / `updateMerchOrderStatus` reuse existing `merch:read` / `merch:update` permissions. Resolvers and SDL register through the existing `typeDefs` array and `resolvers` spread, mirroring the merch feature.

**Tech Stack:** TypeScript, Apollo Server, Prisma (Postgres), Jest + ts-jest.

## Global Constraints

- Imports use the `@/` alias mapped to `src/` (jest `moduleNameMapper`, tsconfig paths). Copy verbatim.
- Resolver `context` is `GraphQLContext` from `@/types`; the request user is `context.user?` (type `AuthenticatedUser`, **`undefined` for guests**), tenant is `context.tenant?`.
- Throw `ValidationError` / `NotFoundError` from `@/utils/errors` for failures — never return error envelopes.
- Guest mutations take **no** auth decorator. Admin resolvers use `withPermission('merch:read'|'merch:update')(authenticated(fn))` from `@/graphql/decorators/auth`.
- Never trust client-supplied prices/totals — recompute `unitPrice`/`subtotal`/`total` from the DB product.
- Currency default is `MNT`. Order status default is `PENDING`. Payment method is `BANK_TRANSFER`.
- Single-test command: `npx jest --testPathPattern="<path>" --no-coverage`. Full suite: `npx jest`.

---

## File Structure

- `jest.config.js` — fix `moduleNameMapping` → `moduleNameMapper` so the `@/` alias resolves in tests (Task 1).
- `prisma/schema.prisma` — add `MerchOrder`, `MerchOrderItem`, `MerchOrderStatus` (Task 2).
- `src/graphql/schema/order/index.ts` — new SDL for order types, inputs, query/mutation extensions (Task 3).
- `src/graphql/schema/index.ts` — register `orderSchema` in `typeDefs` (Task 3).
- `src/graphql/resolvers/mutations/order.ts` — `createMerchOrder`, `updateMerchOrderStatus`, `generateOrderNumber` (Tasks 4, 6).
- `src/graphql/resolvers/queries/order.ts` — `getMerchOrders`, `getMerchOrderById` (Task 5).
- `src/graphql/resolvers/index.ts` — spread `orderQueries` / `orderMutations` (Tasks 4–6).
- `tests/merch-order.mutations.test.ts` — createMerchOrder + updateMerchOrderStatus tests (Tasks 4, 6).
- `tests/merch-order.queries.test.ts` — admin query tests (Task 5).

---

### Task 1: Fix jest module alias

The new order tests import the resolver, which imports `@/types`, `@/utils/errors`, `@/graphql/decorators/auth`. The jest config has a typo (`moduleNameMapping`) so the `@/` alias never maps. Fix it and confirm the existing suite stays green.

**Files:**
- Modify: `jest.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: working `@/` alias resolution in all jest tests.

- [ ] **Step 1: Make the failing case visible**

Run: `npx jest --no-coverage`
Expected: existing tests run; note the current pass/fail baseline (record the number of passing tests).

- [ ] **Step 2: Fix the config key**

In `jest.config.js`, rename the key `moduleNameMapping` to `moduleNameMapper` (value unchanged):

```js
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
```

- [ ] **Step 3: Verify existing suite still passes**

Run: `npx jest --no-coverage`
Expected: PASS — same or more tests passing than the Step 1 baseline, zero new failures.

- [ ] **Step 4: Commit**

```bash
git add jest.config.js
git commit -m "fix: correct jest moduleNameMapper key so @/ alias resolves in tests"
```

---

### Task 2: Add order Prisma models + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: existing `MerchProduct` model (read-only reference).
- Produces: Prisma client types `MerchOrder`, `MerchOrderItem`, enum `MerchOrderStatus`, and a `merchOrder` / `merchOrderItem` delegate on the client. `MerchOrder` has relation field `items: MerchOrderItem[]`; `MerchOrderItem` has back-relation `order`.

- [ ] **Step 1: Add the models to the schema**

Append to `prisma/schema.prisma` (after the existing merch models):

```prisma
model MerchOrder {
  id            String           @id @default(cuid())
  orderNumber   String           @unique
  userId        String?
  customerName  String
  phone         String
  email         String?
  address       String
  notes         String?
  status        MerchOrderStatus @default(PENDING)
  paymentMethod String           @default("BANK_TRANSFER")
  subtotal      Float
  total         Float
  currency      String           @default("MNT")
  tenantId      String
  items         MerchOrderItem[]
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  @@index([tenantId])
  @@index([status])
  @@map("merch_orders")
}

model MerchOrderItem {
  id          String     @id @default(cuid())
  orderId     String
  order       MerchOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId   String
  name        String
  image       String?
  variantId   String?
  variantName String?
  unitPrice   Float
  quantity    Int

  @@index([orderId])
  @@map("merch_order_items")
}

enum MerchOrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
}
```

- [ ] **Step 2: Validate the schema**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 3: Create the migration and regenerate the client**

Run: `npx prisma migrate dev --name add_merch_orders`
Expected: a new folder under `prisma/migrations/*_add_merch_orders/` with `migration.sql`, and "✔ Generated Prisma Client". (Requires a reachable dev Postgres at `DATABASE_URL`. If none is available locally, run `npx prisma generate` to update client types and apply the migration on the server later with `npx prisma migrate deploy`.)

- [ ] **Step 4: Confirm client types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Confirms `prisma.merchOrder` / `prisma.merchOrderItem` exist on the client type.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add MerchOrder and MerchOrderItem models"
```

---

### Task 3: Add order GraphQL SDL

**Files:**
- Create: `src/graphql/schema/order/index.ts`
- Modify: `src/graphql/schema/index.ts`

**Interfaces:**
- Consumes: the existing `typeDefs` array in `src/graphql/schema/index.ts`; base `Query`/`Mutation` types; scalars `DateTime`, `JSON`.
- Produces: GraphQL types `MerchOrder`, `MerchOrderItem`; inputs `CreateMerchOrderInput`, `CreateMerchOrderItemInput`; fields `Query.getMerchOrders`, `Query.getMerchOrderById`, `Mutation.createMerchOrder`, `Mutation.updateMerchOrderStatus`.

- [ ] **Step 1: Write the SDL module**

Create `src/graphql/schema/order/index.ts`:

```ts
export const orderSchema = `
  type MerchOrderItem {
    id: ID!
    productId: String!
    name: String!
    image: String
    variantId: String
    variantName: String
    unitPrice: Float!
    quantity: Int!
  }

  type MerchOrder {
    id: ID!
    orderNumber: String!
    userId: String
    customerName: String!
    phone: String!
    email: String
    address: String!
    notes: String
    status: String!
    paymentMethod: String!
    subtotal: Float!
    total: Float!
    currency: String!
    tenantId: String!
    items: [MerchOrderItem!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input CreateMerchOrderItemInput {
    productId: String!
    variantId: String
    variantName: String
    quantity: Int!
  }

  input CreateMerchOrderInput {
    customerName: String!
    phone: String!
    email: String
    address: String!
    notes: String
    currency: String
    tenantId: String
    items: [CreateMerchOrderItemInput!]!
  }

  extend type Query {
    getMerchOrders(status: String, tenantId: String, limit: Int, offset: Int): [MerchOrder!]!
    getMerchOrderById(id: ID!): MerchOrder
  }

  extend type Mutation {
    createMerchOrder(input: CreateMerchOrderInput!): MerchOrder!
    updateMerchOrderStatus(id: ID!, status: String!): MerchOrder!
  }
`;
```

- [ ] **Step 2: Register the schema**

In `src/graphql/schema/index.ts`, add the import near the other domain-schema imports:

```ts
import { orderSchema } from './order';
```

and add `orderSchema` to the `typeDefs` array (after `merchSchema`):

```ts
export const typeDefs = [
  baseSchema,
  authSchema,
  newsSchema,
  merchSchema,
  orderSchema,
  contentSchema,
  uploadTypeDefs,
  rallySchema,
  teamSchema,
  rangerSchema,
  participantSchema,
];
```

(Match the actual existing array contents; insert `orderSchema` after `merchSchema`.)

- [ ] **Step 3: Verify the schema builds**

Run: `npx tsc --noEmit`
Expected: PASS. (The SDL is a template string; this confirms the import wiring compiles. The full schema-build is exercised in Task 4's resolver test and at server boot.)

- [ ] **Step 4: Commit**

```bash
git add src/graphql/schema/order/index.ts src/graphql/schema/index.ts
git commit -m "feat: add merch order GraphQL schema"
```

---

### Task 4: Implement createMerchOrder resolver (guest)

**Files:**
- Create: `src/graphql/resolvers/mutations/order.ts`
- Modify: `src/graphql/resolvers/index.ts`
- Test: `tests/merch-order.mutations.test.ts`

**Interfaces:**
- Consumes: `GraphQLContext` (`@/types`), `ValidationError` + `NotFoundError` (`@/utils/errors`), `generateRandomString` (`@/utils`), `getLocalizedContent` (`@/libs/localization`).
- Produces:
  - `generateOrderNumber(): string` — returns `MEC-YYYYMMDD-XXXXXX`.
  - `createMerchOrder(parent, args: { input: CreateMerchOrderInput }, context: GraphQLContext): Promise<MerchOrder>` — guest resolver, no decorator.
  - `orderMutations` object exporting `{ createMerchOrder }` (extended in Task 6).
  - Input shape: `CreateMerchOrderInput = { customerName, phone, address, email?, notes?, currency?, tenantId?, items: { productId, variantId?, variantName?, quantity }[] }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/merch-order.mutations.test.ts`:

```ts
import { orderMutations } from '../src/graphql/resolvers/mutations/order';

function buildContext(overrides: any = {}) {
  const product = {
    id: 'prod-1',
    name: { en: 'Test Tee', mn: 'Тест' },
    price: 100,
    currency: 'MNT',
    inventory: 10,
    trackInventory: true,
    allowBackorder: false,
    status: 'ACTIVE',
    featuredImage: 'https://cdn/img.jpg',
    tenantId: 'tenant-1',
    deletedAt: null,
    ...overrides.product,
  };
  const tx = {
    merchProduct: {
      findUnique: jest.fn().mockResolvedValue(product),
      update: jest.fn().mockResolvedValue({ ...product, inventory: product.inventory - 1 }),
    },
    merchOrder: {
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'order-1', ...data, items: data.items?.create ?? [] })),
    },
  };
  const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
  return {
    context: { prisma, user: undefined, tenant: { id: 'tenant-1' }, ...overrides.context } as any,
    tx,
    product,
  };
}

const validInput = {
  customerName: 'Bat',
  phone: '99001122',
  address: 'UB, Khan-Uul',
  items: [{ productId: 'prod-1', quantity: 2 }],
};

describe('createMerchOrder', () => {
  it('creates an order for a guest and snapshots product data', async () => {
    const { context, tx } = buildContext();
    const order = await orderMutations.createMerchOrder({}, { input: validInput }, context);
    expect(order.orderNumber).toMatch(/^MEC-\d{8}-[A-Z0-9]{6}$/);
    expect(order.userId).toBeNull();
    expect(order.subtotal).toBe(200);
    expect(order.total).toBe(200);
    expect(order.status).toBe('PENDING');
    expect(order.paymentMethod).toBe('BANK_TRANSFER');
    const createArg = tx.merchOrder.create.mock.calls[0][0].data;
    expect(createArg.items.create[0]).toMatchObject({
      productId: 'prod-1', name: 'Test Tee', image: 'https://cdn/img.jpg', unitPrice: 100, quantity: 2,
    });
  });

  it('decrements inventory by the ordered quantity', async () => {
    const { context, tx } = buildContext();
    await orderMutations.createMerchOrder({}, { input: validInput }, context);
    expect(tx.merchProduct.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { inventory: { decrement: 2 } },
    });
  });

  it('rejects an empty cart', async () => {
    const { context } = buildContext();
    await expect(
      orderMutations.createMerchOrder({}, { input: { ...validInput, items: [] } }, context)
    ).rejects.toThrow('Cart is empty');
  });

  it('rejects a missing customer name', async () => {
    const { context } = buildContext();
    await expect(
      orderMutations.createMerchOrder({}, { input: { ...validInput, customerName: '  ' } }, context)
    ).rejects.toThrow('Customer name is required');
  });

  it('rejects an inactive product', async () => {
    const { context } = buildContext({ product: { status: 'DRAFT' } });
    await expect(
      orderMutations.createMerchOrder({}, { input: validInput }, context)
    ).rejects.toThrow('not available');
  });

  it('rejects insufficient stock', async () => {
    const { context } = buildContext({ product: { inventory: 1 } });
    await expect(
      orderMutations.createMerchOrder({}, { input: validInput }, context)
    ).rejects.toThrow('Insufficient stock');
  });

  it('throws NotFound when product is missing', async () => {
    const { context, tx } = buildContext();
    tx.merchProduct.findUnique.mockResolvedValueOnce(null);
    await expect(
      orderMutations.createMerchOrder({}, { input: validInput }, context)
    ).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --testPathPattern="tests/merch-order.mutations.test.ts" --no-coverage`
Expected: FAIL — cannot find module `../src/graphql/resolvers/mutations/order`.

- [ ] **Step 3: Implement the resolver**

Create `src/graphql/resolvers/mutations/order.ts`:

```ts
import { GraphQLContext } from '@/types';
import { ValidationError, NotFoundError } from '@/utils/errors';
import { generateRandomString } from '@/utils';
import { getLocalizedContent } from '@/libs/localization';
import { createLogger } from '@/utils/logger';

const logger = createLogger('MERCH_ORDER_MUTATIONS');

interface CreateMerchOrderItemInput {
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  quantity: number;
}

interface CreateMerchOrderInput {
  customerName: string;
  phone: string;
  email?: string | null;
  address: string;
  notes?: string | null;
  currency?: string | null;
  tenantId?: string | null;
  items: CreateMerchOrderItemInput[];
}

export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `MEC-${date}-${generateRandomString(6).toUpperCase()}`;
}

export const createMerchOrder = async (
  _parent: any,
  args: { input: CreateMerchOrderInput },
  context: GraphQLContext
) => {
  const { input } = args;

  if (!input.customerName?.trim()) throw new ValidationError('Customer name is required');
  if (!input.phone?.trim()) throw new ValidationError('Phone is required');
  if (!input.address?.trim()) throw new ValidationError('Delivery address is required');
  if (!input.items?.length) throw new ValidationError('Cart is empty');

  const tenantId = context.tenant?.id || input.tenantId || undefined;
  if (!tenantId) throw new ValidationError('Tenant is required');

  try {
    const order = await (context.prisma as any).$transaction(async (tx: any) => {
      let subtotal = 0;
      const itemsData: any[] = [];

      for (const item of input.items) {
        if (!item.quantity || item.quantity < 1) {
          throw new ValidationError('Item quantity must be at least 1');
        }
        const product = await tx.merchProduct.findUnique({ where: { id: item.productId } });
        if (!product || product.deletedAt) throw new NotFoundError('Merchandise product');
        if (product.status !== 'ACTIVE') {
          throw new ValidationError(`Product is not available: ${item.productId}`);
        }
        if (product.trackInventory && !product.allowBackorder && product.inventory < item.quantity) {
          throw new ValidationError(`Insufficient stock for product: ${item.productId}`);
        }

        const unitPrice = product.price;
        subtotal += unitPrice * item.quantity;
        itemsData.push({
          productId: product.id,
          name: getLocalizedContent(product.name, 'en') || '',
          image: product.featuredImage ?? null,
          variantId: item.variantId ?? null,
          variantName: item.variantName ?? null,
          unitPrice,
          quantity: item.quantity,
        });

        if (product.trackInventory) {
          await tx.merchProduct.update({
            where: { id: product.id },
            data: { inventory: { decrement: item.quantity } },
          });
        }
      }

      const total = subtotal;

      return tx.merchOrder.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: context.user?.id ?? null,
          customerName: input.customerName.trim(),
          phone: input.phone.trim(),
          email: input.email ?? null,
          address: input.address.trim(),
          notes: input.notes ?? null,
          status: 'PENDING',
          paymentMethod: 'BANK_TRANSFER',
          subtotal,
          total,
          currency: input.currency ?? 'MNT',
          tenantId,
          items: { create: itemsData },
        },
        include: { items: true },
      });
    });

    return order;
  } catch (error) {
    logger.error('createMerchOrder failed', error as Error);
    throw error;
  }
};

export const orderMutations = {
  createMerchOrder,
};
```

(If `@/utils/logger`'s `createLogger` signature differs, match the import used in `src/graphql/resolvers/mutations/merch.ts`.)

- [ ] **Step 4: Register the mutation**

In `src/graphql/resolvers/index.ts`, add the import beside the other mutation imports:

```ts
import { orderMutations } from './mutations/order';
```

and spread it into the `Mutation` object (after `...merchMutations`):

```ts
  Mutation: {
    ...authMutations,
    ...merchMutations,
    ...orderMutations,
    // ...rest unchanged
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --testPathPattern="tests/merch-order.mutations.test.ts" --no-coverage`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/graphql/resolvers/mutations/order.ts src/graphql/resolvers/index.ts tests/merch-order.mutations.test.ts
git commit -m "feat: add guest createMerchOrder mutation with stock validation"
```

---

### Task 5: Implement admin order queries

**Files:**
- Create: `src/graphql/resolvers/queries/order.ts`
- Modify: `src/graphql/resolvers/index.ts`
- Test: `tests/merch-order.queries.test.ts`

**Interfaces:**
- Consumes: `GraphQLContext`; `authenticated` + `withPermission` (`@/graphql/decorators/auth`).
- Produces:
  - `getMerchOrders(parent, args: { status?, tenantId?, limit?, offset? }, context): Promise<MerchOrder[]>` — `withPermission('merch:read')(authenticated(...))`.
  - `getMerchOrderById(parent, args: { id }, context): Promise<MerchOrder | null>` — same guard.
  - `orderQueries` object exporting both.

- [ ] **Step 1: Write the failing tests**

Create `tests/merch-order.queries.test.ts`:

```ts
import { orderQueries } from '../src/graphql/resolvers/queries/order';

function adminContext() {
  return {
    prisma: {
      merchOrder: {
        findMany: jest.fn().mockResolvedValue([{ id: 'order-1', orderNumber: 'MEC-20260618-ABC123' }]),
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'MEC-20260618-ABC123' }),
      },
    },
    user: { id: 'admin-1', permissions: ['merch:read', 'merch:update'], roles: ['admin'] },
    tenant: { id: 'tenant-1' },
  } as any;
}

describe('order queries (admin)', () => {
  it('getMerchOrders returns orders for an authorized admin', async () => {
    const context = adminContext();
    const result = await orderQueries.getMerchOrders({}, { limit: 10, offset: 0 }, context);
    expect(result).toHaveLength(1);
    expect(context.prisma.merchOrder.findMany).toHaveBeenCalled();
  });

  it('getMerchOrders rejects an unauthenticated guest', async () => {
    const context = { prisma: {}, user: undefined } as any;
    await expect(orderQueries.getMerchOrders({}, {}, context)).rejects.toThrow();
  });

  it('getMerchOrders rejects a user lacking merch:read', async () => {
    const context = adminContext();
    context.user.permissions = [];
    await expect(orderQueries.getMerchOrders({}, {}, context)).rejects.toThrow();
  });

  it('getMerchOrderById returns a single order with items', async () => {
    const context = adminContext();
    const result = await orderQueries.getMerchOrderById({}, { id: 'order-1' }, context);
    expect(result?.id).toBe('order-1');
    expect(context.prisma.merchOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' }, include: { items: true } })
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --testPathPattern="tests/merch-order.queries.test.ts" --no-coverage`
Expected: FAIL — cannot find module `../src/graphql/resolvers/queries/order`.

- [ ] **Step 3: Implement the queries**

Create `src/graphql/resolvers/queries/order.ts`:

```ts
import { GraphQLContext } from '@/types';
import { authenticated, withPermission } from '@/graphql/decorators/auth';

export const getMerchOrders = withPermission('merch:read')(
  authenticated(async (
    _parent: any,
    args: { status?: string; tenantId?: string; limit?: number; offset?: number },
    context: GraphQLContext
  ) => {
    const where: any = {};
    if (args.status) where.status = args.status;
    if (args.tenantId) where.tenantId = args.tenantId;

    return context.prisma.merchOrder.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: args.limit ?? 50,
      skip: args.offset ?? 0,
    });
  })
);

export const getMerchOrderById = withPermission('merch:read')(
  authenticated(async (
    _parent: any,
    args: { id: string },
    context: GraphQLContext
  ) => {
    return context.prisma.merchOrder.findUnique({
      where: { id: args.id },
      include: { items: true },
    });
  })
);

export const orderQueries = {
  getMerchOrders,
  getMerchOrderById,
};
```

- [ ] **Step 4: Register the queries**

In `src/graphql/resolvers/index.ts`, add the import:

```ts
import { orderQueries } from './queries/order';
```

and spread it into the `Query` object (after `...merchQueries`):

```ts
  Query: {
    // ...existing
    ...merchQueries,
    ...orderQueries,
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --testPathPattern="tests/merch-order.queries.test.ts" --no-coverage`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/graphql/resolvers/queries/order.ts src/graphql/resolvers/index.ts tests/merch-order.queries.test.ts
git commit -m "feat: add admin merch order queries"
```

---

### Task 6: Implement updateMerchOrderStatus + boot check

**Files:**
- Modify: `src/graphql/resolvers/mutations/order.ts`
- Modify: `tests/merch-order.mutations.test.ts`

**Interfaces:**
- Consumes: `authenticated` + `withPermission` (`@/graphql/decorators/auth`); the `MerchOrderStatus` enum values from Task 2.
- Produces: `updateMerchOrderStatus(parent, args: { id, status }, context): Promise<MerchOrder>` — `withPermission('merch:update')(authenticated(...))`; added to `orderMutations`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/merch-order.mutations.test.ts`:

```ts
describe('updateMerchOrderStatus', () => {
  function adminCtx() {
    return {
      prisma: {
        merchOrder: {
          update: jest.fn().mockResolvedValue({ id: 'order-1', status: 'CONFIRMED', items: [] }),
        },
      },
      user: { id: 'admin-1', permissions: ['merch:update'], roles: ['admin'] },
    } as any;
  }

  it('updates an order status for an authorized admin', async () => {
    const context = adminCtx();
    const result = await orderMutations.updateMerchOrderStatus(
      {}, { id: 'order-1', status: 'CONFIRMED' }, context
    );
    expect(result.status).toBe('CONFIRMED');
    expect(context.prisma.merchOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' }, data: { status: 'CONFIRMED' } })
    );
  });

  it('rejects an invalid status value', async () => {
    const context = adminCtx();
    await expect(
      orderMutations.updateMerchOrderStatus({}, { id: 'order-1', status: 'BOGUS' }, context)
    ).rejects.toThrow('Invalid status');
  });

  it('rejects a user lacking merch:update', async () => {
    const context = adminCtx();
    context.user.permissions = [];
    await expect(
      orderMutations.updateMerchOrderStatus({}, { id: 'order-1', status: 'CONFIRMED' }, context)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --testPathPattern="tests/merch-order.mutations.test.ts" --no-coverage`
Expected: FAIL — `orderMutations.updateMerchOrderStatus is not a function`.

- [ ] **Step 3: Implement the mutation**

In `src/graphql/resolvers/mutations/order.ts`, add the imports at the top:

```ts
import { authenticated, withPermission } from '@/graphql/decorators/auth';
```

Add this resolver above the `orderMutations` export:

```ts
const VALID_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export const updateMerchOrderStatus = withPermission('merch:update')(
  authenticated(async (
    _parent: any,
    args: { id: string; status: string },
    context: GraphQLContext
  ) => {
    if (!VALID_ORDER_STATUSES.includes(args.status)) {
      throw new ValidationError(`Invalid status: ${args.status}`);
    }
    return context.prisma.merchOrder.update({
      where: { id: args.id },
      data: { status: args.status as any },
      include: { items: true },
    });
  })
);
```

Update the export to include it:

```ts
export const orderMutations = {
  createMerchOrder,
  updateMerchOrderStatus,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --testPathPattern="tests/merch-order.mutations.test.ts" --no-coverage`
Expected: PASS — all 10 tests (7 from Task 4 + 3 here) green.

- [ ] **Step 5: Full suite + typecheck + schema boot check**

Run: `npx jest --no-coverage`
Expected: PASS — entire suite green.

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run build`
Expected: PASS — confirms the SDL + resolvers assemble (Apollo schema builds without "Cannot use undefined resolver" / missing-type errors).

- [ ] **Step 6: Commit**

```bash
git add src/graphql/resolvers/mutations/order.ts tests/merch-order.mutations.test.ts
git commit -m "feat: add updateMerchOrderStatus admin mutation"
```

---

## Self-Review

**Spec coverage (Phase 1 only):**
- MerchOrder + MerchOrderItem models with guest fields, snapshots, status enum → Task 2. ✓
- Guest `createOrder` with no auth, stock validation, server-side totals, inventory decrement in a transaction → Task 4. ✓
- Admin `getMerchOrders` / `getMerchOrderById` → Task 5; `updateOrderStatus` → Task 6 (permission-guarded). ✓
- orderNumber generation → Task 4 (`generateOrderNumber`). ✓
- Registration through typeDefs + resolvers spread → Tasks 3–6. ✓
- Tests: happy path, empty cart, missing fields, inactive product, insufficient stock, not-found, inventory decrement, guest no-token, permission checks, orderNumber format → Tasks 4–6. ✓
- Phases 2–4 (storefront card/gallery/cart/checkout, admin gallery + orders UI) are intentionally separate plans.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two "match the actual existing array/import" notes are alignment guards, not placeholders — the inserted lines are given verbatim.

**Type consistency:** `orderMutations` / `orderQueries` exports consistent across Tasks 4–6 and the registration steps. `CreateMerchOrderInput` field names match the SDL (Task 3) and the resolver (Task 4). `generateOrderNumber` format `MEC-\d{8}-[A-Z0-9]{6}` matches the test regex. Status values consistent between enum (Task 2), SDL, and `VALID_ORDER_STATUSES` (Task 6).
