# Merch Discounts — Backend (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `MerchDiscount` entity (percent/amount, date window, many-to-many with products) to the backend, with CRUD API, computed discounted-price fields on products, and discount application at order time.

**Architecture:** New Prisma model + additive fields on `MerchProduct`/`MerchOrder`/`MerchOrderItem`. A single pure helper `resolveActiveDiscount` implements best-price-wins pricing and is reused by (a) product read resolvers to expose computed fields and (b) `createMerchOrder` to charge discounted totals server-side. GraphQL follows the existing per-domain `index.ts` typedef + `queries/`/`mutations/` resolver pattern; resolvers use the `withPermission(perm)(authenticated(fn))` wrapper and mocked-Prisma-in-context unit tests.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Apollo Server, Jest.

**Spec:** `docs/superpowers/specs/2026-08-30-merch-discounts-and-order-export-design.md`

## Global Constraints

- Multi-tenant: all discount reads/writes are scoped by `tenantId`; writes take `tenantId` from `context.user.tenantId`, never from input.
- Soft delete: `deletedAt: null` filter on reads; deletes set `deletedAt`.
- Permissions reused verbatim: `merch:read`, `merch:create`, `merch:update`, `merch:delete`.
- Money is `Float`; discounted prices floor at `0`. Percent `value` is 0–100.
- Migrations dir is gitignored — apply DDL to the DB out-of-band; only `schema.prisma` is committed (drives build-time `prisma generate`).
- Resolver call convention in tests: `resolver(parent, args, context)` with `context = { prisma, user: { permissions, tenantId }, tenant }`.

---

### Task 1: Prisma schema — `MerchDiscount` model + additive fields

**Files:**
- Modify: `prisma/schema.prisma` (add model + enum near the other Merch models ~line 640-870)
- DB: apply matching DDL to dev/prod out-of-band (migrations gitignored)

**Interfaces:**
- Produces: Prisma models `MerchDiscount` (fields `id,name,type,value,startDate,endDate,isActive,tenantId,products,createdAt,updatedAt,deletedAt`), enum `MerchDiscountType { PERCENT, AMOUNT }`; `MerchProduct.discounts MerchDiscount[]`; `MerchOrder.discountTotal Float`; `MerchOrderItem.originalUnitPrice Float?`.

- [ ] **Step 1: Add the enum and model to `schema.prisma`**

```prisma
enum MerchDiscountType {
  PERCENT
  AMOUNT
}

model MerchDiscount {
  id        String            @id @default(cuid())
  name      String
  type      MerchDiscountType
  value     Float
  startDate DateTime
  endDate   DateTime
  isActive  Boolean           @default(true)

  tenantId String
  tenant   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  products MerchProduct[] @relation("MerchProductDiscounts")

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([tenantId, isActive, startDate, endDate])
  @@map("merch_discounts")
}
```

- [ ] **Step 2: Add the back-relations/fields to existing models**

In `model MerchProduct` add:
```prisma
  discounts MerchDiscount[] @relation("MerchProductDiscounts")
```
In `model Tenant` add to its relation list:
```prisma
  merchDiscounts MerchDiscount[]
```
In `model MerchOrder` add:
```prisma
  discountTotal Float @default(0)
```
In `model MerchOrderItem` add:
```prisma
  originalUnitPrice Float?
```

- [ ] **Step 3: Generate the Prisma client and apply DDL to the dev DB**

Run:
```bash
npx prisma generate
```
Then apply the equivalent DDL to the database (implicit m2m creates a join table `_MerchProductDiscounts`):
```sql
CREATE TABLE IF NOT EXISTS "merch_discounts" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "value" double precision NOT NULL,
  "startDate" timestamp(3) NOT NULL,
  "endDate" timestamp(3) NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "tenantId" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "deletedAt" timestamp(3)
);
ALTER TABLE "merch_orders" ADD COLUMN IF NOT EXISTS "discountTotal" double precision NOT NULL DEFAULT 0;
ALTER TABLE "merch_order_items" ADD COLUMN IF NOT EXISTS "originalUnitPrice" double precision;
CREATE TABLE IF NOT EXISTS "_MerchProductDiscounts" (
  "A" text NOT NULL REFERENCES "merch_discounts"("id") ON DELETE CASCADE,
  "B" text NOT NULL REFERENCES "merch_products"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "_MerchProductDiscounts_AB_unique" ON "_MerchProductDiscounts"("A","B");
CREATE INDEX IF NOT EXISTS "_MerchProductDiscounts_B_index" ON "_MerchProductDiscounts"("B");
```
Expected: `prisma generate` succeeds; `MerchDiscount` appears on the generated client (`npx prisma validate` passes).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(merch): add MerchDiscount model and additive order discount fields"
```

---

### Task 2: `resolveActiveDiscount` pricing helper (pure, unit-tested)

**Files:**
- Create: `src/libs/discounts.ts`
- Test: `tests/discounts.helper.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type DiscountLike = { id: string; type: 'PERCENT' | 'AMOUNT'; value: number; startDate: Date; endDate: Date; isActive: boolean };
  type DiscountResult = { discount: DiscountLike; discountedPrice: number; discountAmount: number };
  function applyDiscount(price: number, d: DiscountLike): number; // discounted price, floored at 0
  function resolveActiveDiscount(price: number, discounts: DiscountLike[], now: Date): DiscountResult | null;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { applyDiscount, resolveActiveDiscount } from '../src/libs/discounts';

const d = (o: Partial<any>) => ({
  id: 'd', type: 'PERCENT', value: 10, isActive: true,
  startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), ...o,
});
const NOW = new Date('2026-06-01');

describe('applyDiscount', () => {
  it('percent reduces proportionally', () => {
    expect(applyDiscount(100, d({ type: 'PERCENT', value: 25 }))).toBe(75);
  });
  it('amount subtracts and floors at 0', () => {
    expect(applyDiscount(30, d({ type: 'AMOUNT', value: 50 }))).toBe(0);
  });
});

describe('resolveActiveDiscount', () => {
  it('returns null when no discounts', () => {
    expect(resolveActiveDiscount(100, [], NOW)).toBeNull();
  });
  it('ignores inactive or out-of-window discounts', () => {
    const inactive = d({ isActive: false });
    const past = d({ endDate: new Date('2026-02-01') });
    expect(resolveActiveDiscount(100, [inactive, past], NOW)).toBeNull();
  });
  it('best-price-wins picks the largest reduction', () => {
    const r = resolveActiveDiscount(100, [d({ id: 'a', type: 'PERCENT', value: 10 }), d({ id: 'b', type: 'AMOUNT', value: 30 })], NOW);
    expect(r?.discount.id).toBe('b');
    expect(r?.discountedPrice).toBe(70);
    expect(r?.discountAmount).toBe(30);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/discounts.helper.test.ts`
Expected: FAIL — cannot find module `../src/libs/discounts`.

- [ ] **Step 3: Implement `src/libs/discounts.ts`**

```ts
export type DiscountLike = {
  id: string;
  type: 'PERCENT' | 'AMOUNT';
  value: number;
  startDate: Date | string;
  endDate: Date | string;
  isActive: boolean;
};
export type DiscountResult = { discount: DiscountLike; discountedPrice: number; discountAmount: number };

export function applyDiscount(price: number, d: DiscountLike): number {
  const raw = d.type === 'PERCENT' ? price * (1 - d.value / 100) : price - d.value;
  return Math.max(0, Number(raw.toFixed(2)));
}

function isWithinWindow(d: DiscountLike, now: Date): boolean {
  const start = new Date(d.startDate).getTime();
  const end = new Date(d.endDate).getTime();
  return d.isActive && start <= now.getTime() && now.getTime() <= end;
}

export function resolveActiveDiscount(price: number, discounts: DiscountLike[], now: Date): DiscountResult | null {
  const candidates = (discounts || []).filter((d) => isWithinWindow(d, now));
  if (candidates.length === 0) return null;
  let best: DiscountResult | null = null;
  for (const d of candidates) {
    const discountedPrice = applyDiscount(price, d);
    if (best === null || discountedPrice < best.discountedPrice) {
      best = { discount: d, discountedPrice, discountAmount: Number((price - discountedPrice).toFixed(2)) };
    }
  }
  return best;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/discounts.helper.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/libs/discounts.ts tests/discounts.helper.test.ts
git commit -m "feat(merch): add resolveActiveDiscount best-price-wins helper"
```

---

### Task 3: GraphQL typedefs — discount type, queries, mutations, product fields

**Files:**
- Modify: `src/graphql/schema/merch/index.ts`

**Interfaces:**
- Produces GraphQL SDL: `type MerchDiscount`, `enum MerchDiscountType`, `input CreateMerchDiscountInput`, `input UpdateMerchDiscountInput`, queries `getMerchDiscounts`/`getMerchDiscountById`, mutations `createMerchDiscount`/`updateMerchDiscount`/`deleteMerchDiscount`; adds `discounts`, `activeDiscount`, `discountedPrice`, `discountAmount` to `type MerchProduct`; adds `discountIds: [ID!]` to product create/update inputs.

- [ ] **Step 1: Add SDL to the merch schema string**

Add to the typedefs (inside the existing `gql` template):
```graphql
enum MerchDiscountType { PERCENT AMOUNT }

type MerchDiscount {
  id: ID!
  name: String!
  type: MerchDiscountType!
  value: Float!
  startDate: DateTime!
  endDate: DateTime!
  isActive: Boolean!
  productIds: [ID!]
  createdAt: DateTime!
  updatedAt: DateTime!
}

input CreateMerchDiscountInput {
  name: String!
  type: MerchDiscountType!
  value: Float!
  startDate: DateTime!
  endDate: DateTime!
  isActive: Boolean
  productIds: [ID!]
}

input UpdateMerchDiscountInput {
  name: String
  type: MerchDiscountType
  value: Float
  startDate: DateTime
  endDate: DateTime
  isActive: Boolean
  productIds: [ID!]
}
```
Extend `type MerchProduct` with:
```graphql
  discounts: [MerchDiscount!]
  activeDiscount: MerchDiscount
  discountedPrice: Float
  discountAmount: Float
```
Add to `CreateMerchProductInput` and `UpdateMerchProductInput`:
```graphql
  discountIds: [ID!]
```
Add to the `Query` and `Mutation` blocks:
```graphql
  # Query
  getMerchDiscounts(tenantId: ID, tenantSlug: String, isActive: Boolean, limit: Int, offset: Int): [MerchDiscount!]!
  getMerchDiscountById(id: ID!): MerchDiscount

  # Mutation
  createMerchDiscount(input: CreateMerchDiscountInput!): MerchDiscount!
  updateMerchDiscount(id: ID!, input: UpdateMerchDiscountInput!): MerchDiscount!
  deleteMerchDiscount(id: ID!): Boolean!
```

- [ ] **Step 2: Verify the schema still builds**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors from the SDL string change).

- [ ] **Step 3: Commit**

```bash
git add src/graphql/schema/merch/index.ts
git commit -m "feat(merch): add discount types, queries, mutations and product discount fields to schema"
```

---

### Task 4: Discount query resolvers

**Files:**
- Create: `src/graphql/resolvers/queries/discount.ts`
- Test: `tests/discount.queries.test.ts`

**Interfaces:**
- Consumes: `withPermission`, `authenticated` wrappers (same imports the order/merch resolvers use — check `src/graphql/resolvers/queries/order.ts` for the exact import paths).
- Produces: `export const discountQueries = { getMerchDiscounts, getMerchDiscountById }`. Each maps `products` → `productIds` in the return shape.

- [ ] **Step 1: Write the failing tests**

```ts
import { discountQueries } from '../src/graphql/resolvers/queries/discount';

function ctx() {
  return {
    prisma: {
      merchDiscount: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', name: 'Summer', type: 'PERCENT', value: 10, isActive: true,
            startDate: new Date(), endDate: new Date(), products: [{ id: 'p1' }] },
        ]),
        findUnique: jest.fn().mockResolvedValue(
          { id: 'd1', name: 'Summer', type: 'PERCENT', value: 10, isActive: true,
            startDate: new Date(), endDate: new Date(), products: [{ id: 'p1' }] }),
      },
    },
    user: { id: 'a', permissions: ['merch:read'], tenantId: 'tenant-1' },
    tenant: { id: 'tenant-1' },
  } as any;
}

describe('discount queries', () => {
  it('getMerchDiscounts returns tenant discounts with productIds', async () => {
    const c = ctx();
    const res = await discountQueries.getMerchDiscounts({}, { limit: 10 }, c);
    expect(res[0].productIds).toEqual(['p1']);
    expect(c.prisma.merchDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });
  it('rejects a user lacking merch:read', async () => {
    const c = ctx(); c.user.permissions = [];
    await expect(discountQueries.getMerchDiscounts({}, {}, c)).rejects.toThrow();
  });
  it('getMerchDiscountById returns one', async () => {
    const c = ctx();
    const res = await discountQueries.getMerchDiscountById({}, { id: 'd1' }, c);
    expect(res?.id).toBe('d1');
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/discount.queries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/graphql/resolvers/queries/discount.ts`**

Model it on `src/graphql/resolvers/queries/order.ts` (copy the exact `withPermission`/`authenticated` imports from there). Core logic:
```ts
const mapDiscount = (d: any) => ({ ...d, productIds: (d.products || []).map((p: any) => p.id) });

// getMerchDiscounts
const where: any = { deletedAt: null };
if (args.isActive !== undefined) where.isActive = args.isActive;
where.tenantId = args.tenantId
  ?? (args.tenantSlug ? (await ctx.prisma.tenant.findUnique({ where: { slug: args.tenantSlug } }))?.id : ctx.user.tenantId);
const rows = await ctx.prisma.merchDiscount.findMany({
  where, include: { products: { select: { id: true } } },
  orderBy: { createdAt: 'desc' }, take: args.limit ?? 50, skip: args.offset ?? 0,
});
return rows.map(mapDiscount);

// getMerchDiscountById
const row = await ctx.prisma.merchDiscount.findUnique({
  where: { id: args.id }, include: { products: { select: { id: true } } },
});
return row ? mapDiscount(row) : null;
```
Wrap both with `withPermission('merch:read')(authenticated(async (parent, args, ctx) => {...}))`.

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/discount.queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graphql/resolvers/queries/discount.ts tests/discount.queries.test.ts
git commit -m "feat(merch): add discount query resolvers"
```

---

### Task 5: Discount mutation resolvers

**Files:**
- Create: `src/graphql/resolvers/mutations/discount.ts`
- Test: `tests/discount.mutations.test.ts`

**Interfaces:**
- Consumes: `resolveActiveDiscount` not needed here; the `withPermission`/`authenticated` wrappers as in `src/graphql/resolvers/mutations/order.ts`.
- Produces: `export const discountMutations = { createMerchDiscount, updateMerchDiscount, deleteMerchDiscount }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { discountMutations } from '../src/graphql/resolvers/mutations/discount';

function ctx(overrides: any = {}) {
  return {
    prisma: {
      merchDiscount: {
        create: jest.fn().mockResolvedValue({ id: 'd1', products: [] }),
        update: jest.fn().mockResolvedValue({ id: 'd1', products: [] }),
      },
    },
    user: { id: 'a', permissions: ['merch:create', 'merch:update', 'merch:delete'], tenantId: 'tenant-1' },
    tenant: { id: 'tenant-1' },
    ...overrides,
  } as any;
}

describe('discount mutations', () => {
  it('createMerchDiscount sets tenantId from context and connects products', async () => {
    const c = ctx();
    await discountMutations.createMerchDiscount({}, {
      input: { name: 'Summer', type: 'PERCENT', value: 10, startDate: new Date(), endDate: new Date(), productIds: ['p1', 'p2'] },
    }, c);
    expect(c.prisma.merchDiscount.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        tenantId: 'tenant-1',
        products: { connect: [{ id: 'p1' }, { id: 'p2' }] },
      }) })
    );
  });
  it('updateMerchDiscount uses set for productIds', async () => {
    const c = ctx();
    await discountMutations.updateMerchDiscount({}, { id: 'd1', input: { productIds: ['p3'] } }, c);
    expect(c.prisma.merchDiscount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1' }, data: expect.objectContaining({ products: { set: [{ id: 'p3' }] } }) })
    );
  });
  it('deleteMerchDiscount soft-deletes', async () => {
    const c = ctx();
    c.prisma.merchDiscount.update = jest.fn().mockResolvedValue({ id: 'd1' });
    const ok = await discountMutations.deleteMerchDiscount({}, { id: 'd1' }, c);
    expect(ok).toBe(true);
    expect(c.prisma.merchDiscount.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'd1' }, data: { deletedAt: expect.any(Date) } })
    );
  });
  it('rejects create without merch:create', async () => {
    const c = ctx(); c.user.permissions = [];
    await expect(discountMutations.createMerchDiscount({}, { input: {} }, c)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/discount.mutations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/graphql/resolvers/mutations/discount.ts`**

```ts
const connectProducts = (ids?: string[]) => (ids ? { connect: ids.map((id) => ({ id })) } : undefined);
const setProducts = (ids?: string[]) => (ids ? { set: ids.map((id) => ({ id })) } : undefined);
const mapDiscount = (d: any) => ({ ...d, productIds: (d.products || []).map((p: any) => p.id) });

// createMerchDiscount — withPermission('merch:create')(authenticated(...))
const { productIds, ...rest } = args.input;
const created = await ctx.prisma.merchDiscount.create({
  data: { ...rest, isActive: rest.isActive ?? true, tenantId: ctx.user.tenantId, products: connectProducts(productIds) },
  include: { products: { select: { id: true } } },
});
return mapDiscount(created);

// updateMerchDiscount — withPermission('merch:update')(authenticated(...))
const { productIds: pid, ...upd } = args.input;
const updated = await ctx.prisma.merchDiscount.update({
  where: { id: args.id },
  data: { ...upd, ...(pid ? { products: setProducts(pid) } : {}) },
  include: { products: { select: { id: true } } },
});
return mapDiscount(updated);

// deleteMerchDiscount — withPermission('merch:delete')(authenticated(...))
await ctx.prisma.merchDiscount.update({ where: { id: args.id }, data: { deletedAt: new Date() } });
return true;
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/discount.mutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graphql/resolvers/mutations/discount.ts tests/discount.mutations.test.ts
git commit -m "feat(merch): add discount mutation resolvers (create/update/soft-delete)"
```

---

### Task 6: Product computed discount fields (`activeDiscount`/`discountedPrice`/`discountAmount`) + field resolver

**Files:**
- Modify: `src/graphql/resolvers/queries/merch.ts` (product mapping) and/or add a `MerchProduct` field resolver in the merch resolver map
- Test: `tests/product-discount-fields.test.ts`

**Interfaces:**
- Consumes: `resolveActiveDiscount` from `src/libs/discounts.ts`.
- Produces: product objects returned by `getMerchProducts`/`getMerchProductById` include `discounts` (array with `productIds` omitted, ids only fine), `activeDiscount` (or null), `discountedPrice` (number or null when no active discount), `discountAmount` (number or null).

- [ ] **Step 1: Write the failing test**

```ts
import { computeProductDiscount } from '../src/libs/discounts';

it('computeProductDiscount attaches discounted fields when a discount is active', () => {
  const now = new Date('2026-06-01');
  const product = { price: 100, discounts: [
    { id: 'd', type: 'PERCENT', value: 20, isActive: true, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
  ] };
  const out = computeProductDiscount(product as any, now);
  expect(out.discountedPrice).toBe(80);
  expect(out.discountAmount).toBe(20);
  expect(out.activeDiscount?.id).toBe('d');
});

it('computeProductDiscount returns null fields when none active', () => {
  const out = computeProductDiscount({ price: 100, discounts: [] } as any, new Date());
  expect(out.discountedPrice).toBeNull();
  expect(out.activeDiscount).toBeNull();
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/product-discount-fields.test.ts`
Expected: FAIL — `computeProductDiscount` not exported.

- [ ] **Step 3: Add `computeProductDiscount` to `src/libs/discounts.ts` and wire it into product mapping**

Add helper:
```ts
export function computeProductDiscount<T extends { price: number; discounts?: DiscountLike[] }>(product: T, now: Date) {
  const r = resolveActiveDiscount(product.price, product.discounts || [], now);
  return { ...product, activeDiscount: r?.discount ?? null, discountedPrice: r?.discountedPrice ?? null, discountAmount: r?.discountAmount ?? null };
}
```
In `src/graphql/resolvers/queries/merch.ts`: include `discounts` in the product `include` (`discounts: { where: { deletedAt: null, isActive: true } }`) and map each returned product through `computeProductDiscount(product, new Date())` before/after localization.

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/product-discount-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/libs/discounts.ts src/graphql/resolvers/queries/merch.ts tests/product-discount-fields.test.ts
git commit -m "feat(merch): expose computed discount fields on products"
```

---

### Task 7: Product create/update accept `discountIds`

**Files:**
- Modify: `src/graphql/resolvers/mutations/merch.ts` (createMerchProduct, updateMerchProduct)
- Test: `tests/product-discountids.test.ts`

**Interfaces:**
- Consumes: existing product create/update resolvers.
- Produces: create connects `discountIds`; update sets them (`set`) when provided; input's `discountIds` is stripped from the scalar data object.

- [ ] **Step 1: Write the failing test**

```ts
import { merchMutations } from '../src/graphql/resolvers/mutations/merch';

function ctx() {
  return {
    prisma: {
      merchProduct: {
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      merchVariant: { deleteMany: jest.fn(), createMany: jest.fn() },
    },
    user: { id: 'a', permissions: ['merch:create', 'merch:update'], tenantId: 'tenant-1' },
    tenant: { id: 'tenant-1' },
  } as any;
}

it('createMerchProduct connects discountIds and strips the scalar', async () => {
  const c = ctx();
  await merchMutations.createMerchProduct({}, { input: { name: { en: 'X' }, slug: 'x', price: 10, discountIds: ['d1'] } }, c);
  const data = c.prisma.merchProduct.create.mock.calls[0][0].data;
  expect(data.discounts).toEqual({ connect: [{ id: 'd1' }] });
  expect(data.discountIds).toBeUndefined();
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/product-discountids.test.ts`
Expected: FAIL — `data.discounts` is undefined.

- [ ] **Step 3: Implement in `src/graphql/resolvers/mutations/merch.ts`**

In both create and update, before building `data`, destructure `const { discountIds, ...rest } = input;` and add:
- create: `discounts: discountIds ? { connect: discountIds.map((id: string) => ({ id })) } : undefined`
- update: `...(discountIds ? { discounts: { set: discountIds.map((id: string) => ({ id })) } } : {})`
Ensure `discountIds` never leaks into the scalar `data`.

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/product-discountids.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graphql/resolvers/mutations/merch.ts tests/product-discountids.test.ts
git commit -m "feat(merch): accept discountIds on product create/update"
```

---

### Task 8: Apply discounts in `createMerchOrder`

**Files:**
- Modify: `src/graphql/resolvers/mutations/order.ts` (createMerchOrder)
- Test: `tests/order-discount.test.ts`

**Interfaces:**
- Consumes: `resolveActiveDiscount` from `src/libs/discounts.ts`.
- Produces: order items store `originalUnitPrice` = base product price and `unitPrice` = discounted price; order stores `discountTotal` and `subtotal`/`total` computed from discounted prices.

- [ ] **Step 1: Write the failing test**

```ts
import { orderMutations } from '../src/graphql/resolvers/mutations/order';

function ctx() {
  const now = new Date();
  return {
    prisma: {
      merchProduct: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', name: { en: 'Tee' }, price: 100, currency: 'MNT', featuredImage: null, inventory: 10,
            discounts: [{ id: 'd', type: 'PERCENT', value: 20, isActive: true,
              startDate: new Date(now.getTime() - 1000), endDate: new Date(now.getTime() + 100000) }],
            productVariants: [] },
        ]),
      },
      merchOrder: { create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 'o1', ...a.data })) },
    },
  } as any;
}

it('createMerchOrder charges the discounted price and records discountTotal', async () => {
  const c = ctx();
  await orderMutations.createMerchOrder({}, { input: {
    customerName: 'A', phone: '1', address: 'x',
    items: [{ productId: 'p1', quantity: 2 }],
  } }, c);
  const data = c.prisma.merchOrder.create.mock.calls[0][0].data;
  expect(data.subtotal).toBe(160);   // 80 * 2
  expect(data.total).toBe(160);
  expect(data.discountTotal).toBe(40); // (100-80) * 2
  const item = (data.items.create ?? data.items)[0];
  expect(item.unitPrice).toBe(80);
  expect(item.originalUnitPrice).toBe(100);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/order-discount.test.ts`
Expected: FAIL — totals computed from base price / `discountTotal` undefined.

- [ ] **Step 3: Implement in `createMerchOrder`**

Where the resolver loads products and builds items: include `discounts: { where: { deletedAt: null, isActive: true } }` and `productVariants` in the product fetch. For each requested item, resolve the base price (variant price if `variantId`, else product price), compute `const r = resolveActiveDiscount(basePrice, product.discounts, new Date());` set `unitPrice = r ? r.discountedPrice : basePrice`, `originalUnitPrice = basePrice`, accumulate `discountTotal += (basePrice - unitPrice) * quantity` and `subtotal += unitPrice * quantity`. Set `total = subtotal` (no other adjustments in scope). Persist `originalUnitPrice` on each item and `discountTotal` on the order.

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/order-discount.test.ts`
Expected: PASS. Also run the existing order tests to ensure no regression: `npx jest tests/merch-order`.

- [ ] **Step 5: Commit**

```bash
git add src/graphql/resolvers/mutations/order.ts tests/order-discount.test.ts
git commit -m "feat(merch): apply best-price discount to order totals server-side"
```

---

### Task 9: Wire discount resolvers into the schema/resolver map

**Files:**
- Modify: the root resolver map (find where `merchQueries`/`orderMutations` are merged — likely `src/graphql/resolvers/index.ts`)
- Test: `tests/schema-builds.test.ts` (or reuse an existing schema smoke test if present)

**Interfaces:**
- Consumes: `discountQueries`, `discountMutations`.
- Produces: `Query`/`Mutation` maps include the discount resolvers; `MerchProduct.discounts/activeDiscount/...` resolve.

- [ ] **Step 1: Write the failing test**

```ts
import { resolvers } from '../src/graphql/resolvers';

it('discount resolvers are registered', () => {
  expect(typeof resolvers.Query.getMerchDiscounts).toBe('function');
  expect(typeof resolvers.Query.getMerchDiscountById).toBe('function');
  expect(typeof resolvers.Mutation.createMerchDiscount).toBe('function');
  expect(typeof resolvers.Mutation.updateMerchDiscount).toBe('function');
  expect(typeof resolvers.Mutation.deleteMerchDiscount).toBe('function');
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/schema-builds.test.ts`
Expected: FAIL — resolvers undefined.

- [ ] **Step 3: Merge the discount resolvers**

Import `discountQueries` and `discountMutations` in the resolver index and spread them into the `Query` and `Mutation` maps alongside the existing merch/order resolvers. Confirm the merch typedefs (Task 3) are part of the schema build.

- [ ] **Step 4: Run and verify it passes**

Run: `npx jest tests/schema-builds.test.ts && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/graphql/resolvers tests/schema-builds.test.ts
git commit -m "feat(merch): register discount resolvers in the schema"
```

---

## Self-Review

**Spec coverage:** MerchDiscount model (Task 1) ✓; best-price-wins helper (Task 2) ✓; discount CRUD API (Tasks 3–5) ✓; computed product fields (Task 6) ✓; product `discountIds` (Task 7) ✓; real discount at order time incl. `discountTotal`/`originalUnitPrice` (Task 8) ✓; registration (Task 9) ✓. Admin UI, storefront display, and Excel export are explicitly out of this phase (separate plans).

**Type consistency:** `resolveActiveDiscount(price, discounts, now)`, `applyDiscount(price, d)`, `computeProductDiscount(product, now)`, `discountQueries`, `discountMutations` names are used identically across tasks. Return shape `{ discount, discountedPrice, discountAmount }` consistent.

**Deploy note (post-plan):** apply the Task 1 DDL to prod out-of-band and deploy the backend BEFORE any admin/storefront that queries the new fields (same ordering lesson as the category `image` field). Verify `getMerchDiscounts` and product `discountedPrice` over the prod API before Phase 2.
