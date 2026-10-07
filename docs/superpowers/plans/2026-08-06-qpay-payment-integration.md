# QPay V2 Payment Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merch customers pay via QPay V2 QR / bank-app deeplinks, with all QPay communication server-side only and orders confirmed by a verified callback.

**Architecture:** `createMerchOrder` creates the order as `AWAITING_PAYMENT`; a guest-callable `createQpayInvoice` mutation asks the backend to create a QPay invoice and returns display-safe QR data; QPay hits a secured REST callback when paid; the backend re-verifies with `payment/check` and flips the order to `PAID`. Unpaid invoices expire (default 30 min), restoring inventory and cancelling the QPay invoice. Manual bank transfer is removed.

**Tech Stack:** TypeScript, Apollo Server 5 + Express 4, Prisma 5 (PostgreSQL), ioredis, Jest + ts-node, native `fetch`, Zod for response validation.

## Global Constraints

- Backend only. No QPay credentials or raw payment data ever reach the frontend or the GraphQL response — frontend sees only QR text/image, deeplinks, and status.
- QPay credentials come exclusively from env vars (never hardcoded, never persisted to DB).
- eBarimt, card refund/cancel, multi-currency (MNT only) are out of scope.
- Never poll QPay on a cron/timer for status — confirmation is callback-driven; `payment/check` is only called after a callback (or on-demand during a single status read).
- Migrations are hand-written additive SQL in `migrations/`, matching existing project style (no destructive changes; keep deprecated `paymentClaimedAt`).
- Follow existing patterns: `createLogger('NAME')` for logging, custom error classes from `@/utils/errors`, `@/`-aliased imports, guest resolvers take the id as the only handle (like `markMerchOrderPaid`).
- Path base for QPay code: `src/libs/qpay/`. Tests live in `tests/`.
- Commit message footer on every commit:
  `Claude-Session: https://claude.ai/code/session_01ULskQDv5CnBxJxzj2hVhyW`

---

## File Structure

- Create `src/libs/qpay/qpay-client.ts` — QPay HTTP transport + token cache.
- Create `src/libs/qpay/qpay-service.ts` — order/payment orchestration.
- Create `src/libs/qpay/callback-token.ts` — HMAC sign/verify for the callback URL.
- Create `src/graphql/schema/payment/index.ts` — payment GraphQL types/ops.
- Create `src/routes/qpay-callback.ts` — Express callback router.
- Create tests under `tests/` for each of the above.
- Modify `src/config/index.ts` — QPay config block.
- Modify `.env.example` — QPay env vars.
- Modify `prisma/schema.prisma` — `Payment` model, `PaymentStatus` enum, `MerchOrderStatus` additions, `MerchOrder.payments`, defaults.
- Create `migrations/add-qpay-payments.sql` — additive migration.
- Modify `src/graphql/schema/order/index.ts` — remove `markMerchOrderPaid`, add `payments` field on `MerchOrder`.
- Modify `src/graphql/schema/index.ts` — register `paymentSchema`.
- Modify `src/graphql/resolvers/mutations/order.ts` — order defaults, drop `markMerchOrderPaid`.
- Modify `src/graphql/resolvers/index.ts` — register payment resolvers.
- Modify `src/server.ts` — mount the callback router.

---

## Task 1: QPay configuration & env

**Files:**
- Modify: `src/config/index.ts` (Joi schema ~line 55, config object ~line 84)
- Modify: `.env.example`
- Test: `tests/qpay-config.test.ts`

**Interfaces:**
- Produces: `config.qpay` with shape `{ baseUrl: string; clientId: string; clientSecret: string; invoiceCode: string; callbackBaseUrl: string; callbackSecret: string; invoiceTtlMinutes: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/qpay-config.test.ts
describe('QPay config', () => {
  it('exposes qpay config with a sane default base url and ttl', () => {
    const { config } = require('@/config');
    expect(config.qpay).toBeDefined();
    expect(typeof config.qpay.baseUrl).toBe('string');
    expect(config.qpay.baseUrl).toMatch(/qpay\.mn/);
    expect(config.qpay.invoiceTtlMinutes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/qpay-config.test.ts -v`
Expected: FAIL — `config.qpay` is `undefined`.

- [ ] **Step 3: Add the Joi schema entries**

In `src/config/index.ts`, inside the `configSchema = Joi.object({ ... })` (add near the "File upload" block, before `.unknown(true)`):

```typescript
  // QPay payments
  QPAY_BASE_URL: Joi.string().uri().default('https://merchant-sandbox.qpay.mn'),
  QPAY_CLIENT_ID: Joi.string().allow('').default(''),
  QPAY_CLIENT_SECRET: Joi.string().allow('').default(''),
  QPAY_INVOICE_CODE: Joi.string().allow('').default(''),
  QPAY_CALLBACK_BASE_URL: Joi.string().allow('').default(''),
  QPAY_CALLBACK_SECRET: Joi.string().allow('').default(''),
  QPAY_INVOICE_TTL_MINUTES: Joi.number().min(1).default(30),
```

- [ ] **Step 4: Add the config object block**

In the `export const config = { ... }` object (after the `rateLimit` block):

```typescript
  qpay: {
    baseUrl: envVars.QPAY_BASE_URL as string,
    clientId: envVars.QPAY_CLIENT_ID as string,
    clientSecret: envVars.QPAY_CLIENT_SECRET as string,
    invoiceCode: envVars.QPAY_INVOICE_CODE as string,
    callbackBaseUrl: envVars.QPAY_CALLBACK_BASE_URL as string,
    callbackSecret: envVars.QPAY_CALLBACK_SECRET as string,
    invoiceTtlMinutes: envVars.QPAY_INVOICE_TTL_MINUTES as number,
  },
```

- [ ] **Step 5: Add env docs**

Append to `.env.example`:

```
# QPay V2 payments (sandbox by default; flip base url + creds for production)
QPAY_BASE_URL=https://merchant-sandbox.qpay.mn
QPAY_CLIENT_ID=
QPAY_CLIENT_SECRET=
QPAY_INVOICE_CODE=MONGOLEC_ORG_INVOICE
QPAY_CALLBACK_BASE_URL=
QPAY_CALLBACK_SECRET=
QPAY_INVOICE_TTL_MINUTES=30
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/qpay-config.test.ts -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config/index.ts .env.example tests/qpay-config.test.ts
git commit -m "feat(qpay): add QPay configuration and env vars"
```

---

## Task 2: Prisma Payment model & additive migration

**Files:**
- Modify: `prisma/schema.prisma` (MerchOrder ~816-864)
- Create: `migrations/add-qpay-payments.sql`
- Test: `tests/qpay-schema.test.ts`

**Interfaces:**
- Produces: Prisma `Payment` model + `PaymentStatus` enum; `MerchOrderStatus` gains `AWAITING_PAYMENT`, `PAID`, `EXPIRED`; `MerchOrder.payments Payment[]`. `context.prisma.payment` is available.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/qpay-schema.test.ts
import { Prisma } from '@prisma/client';

describe('QPay Prisma schema', () => {
  it('exposes the Payment model and PaymentStatus enum', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models).toContain('Payment');
    const paymentStatus = Prisma.dmmf.datamodel.enums.find((e) => e.name === 'PaymentStatus');
    expect(paymentStatus?.values.map((v) => v.name)).toEqual(
      expect.arrayContaining(['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED'])
    );
    const orderStatus = Prisma.dmmf.datamodel.enums.find((e) => e.name === 'MerchOrderStatus');
    expect(orderStatus?.values.map((v) => v.name)).toEqual(
      expect.arrayContaining(['AWAITING_PAYMENT', 'PAID', 'EXPIRED'])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/qpay-schema.test.ts -v`
Expected: FAIL — `Payment` not in models.

- [ ] **Step 3: Edit `prisma/schema.prisma`**

Add `payments Payment[]` to the `MerchOrder` model relations (after `items MerchOrderItem[]`). Extend the enum:

```prisma
enum MerchOrderStatus {
  AWAITING_PAYMENT
  PENDING
  PAID
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
  EXPIRED
}
```

Add the new model + enum after `MerchOrderItem` (before the Rally section):

```prisma
model Payment {
  id              String        @id @default(cuid())
  orderId         String
  order           MerchOrder    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  tenantId        String
  provider        String        @default("QPAY")

  senderInvoiceNo String        @unique
  qpayInvoiceId   String?       @unique
  qpayPaymentId   String?

  amount          Float
  currency        String        @default("MNT")
  paidAmount      Float?

  status          PaymentStatus @default(PENDING)

  qrText          String?
  qrImage         String?
  shortUrl        String?
  deeplinks       Json?

  invoiceResponse Json?
  callbackPayload Json?

  expiresAt       DateTime?
  paidAt          DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([orderId])
  @@index([tenantId])
  @@index([status])
  @@map("payments")
}

enum PaymentStatus {
  PENDING
  PAID
  FAILED
  EXPIRED
  CANCELLED
}
```

- [ ] **Step 4: Write the additive migration SQL**

```sql
-- migrations/add-qpay-payments.sql
-- Additive: QPay payments. Safe to run on production with existing data.

ALTER TYPE "MerchOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';
ALTER TYPE "MerchOrderStatus" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "MerchOrderStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "payments" (
  "id"              TEXT PRIMARY KEY,
  "orderId"         TEXT NOT NULL REFERENCES "merch_orders"("id") ON DELETE CASCADE,
  "tenantId"        TEXT NOT NULL,
  "provider"        TEXT NOT NULL DEFAULT 'QPAY',
  "senderInvoiceNo" TEXT NOT NULL,
  "qpayInvoiceId"   TEXT,
  "qpayPaymentId"   TEXT,
  "amount"          DOUBLE PRECISION NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'MNT',
  "paidAmount"      DOUBLE PRECISION,
  "status"          "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "qrText"          TEXT,
  "qrImage"         TEXT,
  "shortUrl"        TEXT,
  "deeplinks"       JSONB,
  "invoiceResponse" JSONB,
  "callbackPayload" JSONB,
  "expiresAt"       TIMESTAMP(3),
  "paidAt"          TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_senderInvoiceNo_key" ON "payments"("senderInvoiceNo");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_qpayInvoiceId_key" ON "payments"("qpayInvoiceId");
CREATE INDEX IF NOT EXISTS "payments_orderId_idx" ON "payments"("orderId");
CREATE INDEX IF NOT EXISTS "payments_tenantId_idx" ON "payments"("tenantId");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");
```

- [ ] **Step 5: Generate the client & apply to dev DB**

Run: `npm run db:generate`
Then apply schema to your dev database: `npm run db:push`
Expected: Prisma client regenerated with `Payment`; dev DB has the `payments` table.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/qpay-schema.test.ts -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma migrations/add-qpay-payments.sql tests/qpay-schema.test.ts
git commit -m "feat(qpay): add Payment model and additive migration"
```

---

## Task 3: Order lifecycle — QPay default, remove bank transfer

**Files:**
- Modify: `src/graphql/resolvers/mutations/order.ts:119-120` (status/paymentMethod), remove `markMerchOrderPaid` (154-174) and its export (176-180)
- Modify: `src/graphql/schema/order/index.ts` (remove `markMerchOrderPaid`, add `payments` field)
- Modify: `tests/merch-order.mutations.test.ts` (update expectations)
- Test: `tests/merch-order.mutations.test.ts`

**Interfaces:**
- Consumes: `MerchOrderStatus.AWAITING_PAYMENT` (Task 2).
- Produces: `createMerchOrder` returns an order with `status: 'AWAITING_PAYMENT'`, `paymentMethod: 'QPAY'`. `markMerchOrderPaid` no longer exists.

- [ ] **Step 1: Update the failing test**

In `tests/merch-order.mutations.test.ts`, find the `createMerchOrder` success assertion and change the expected status/method. Add if missing:

```typescript
it('creates a QPay order in AWAITING_PAYMENT state', async () => {
  const order = await createMerchOrder(null, { input: validInput }, ctx);
  expect(order.status).toBe('AWAITING_PAYMENT');
  expect(order.paymentMethod).toBe('QPAY');
});
```

Remove/adjust any existing test that imports or calls `markMerchOrderPaid`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/merch-order.mutations.test.ts -v`
Expected: FAIL — status is `'PENDING'` / `paymentMethod` is `'BANK_TRANSFER'`.

- [ ] **Step 3: Update `createMerchOrder`**

In `src/graphql/resolvers/mutations/order.ts`, in the `tx.merchOrder.create({ data: {...} })` block:

```typescript
          status: 'AWAITING_PAYMENT',
          paymentMethod: 'QPAY',
```

- [ ] **Step 4: Remove `markMerchOrderPaid`**

Delete the `markMerchOrderPaid` function (the block with the "Guest-callable: the customer clicks 'I've paid'" comment) and remove `markMerchOrderPaid` from the `orderMutations` export object so it reads:

```typescript
export const orderMutations = {
  createMerchOrder,
  updateMerchOrderStatus,
};
```

- [ ] **Step 5: Update the order GraphQL schema**

In `src/graphql/schema/order/index.ts`: remove the `markMerchOrderPaid(id: ID!): MerchOrder!` line from `extend type Mutation`. Add a `payments` field to `type MerchOrder` (after `items`):

```graphql
    payments: [Payment!]!
```

(The `Payment` type itself is defined in Task 6's payment schema, which is registered alongside this one.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/merch-order.mutations.test.ts -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/graphql/resolvers/mutations/order.ts src/graphql/schema/order/index.ts tests/merch-order.mutations.test.ts
git commit -m "feat(qpay): default merch orders to QPay/AWAITING_PAYMENT, drop bank transfer"
```

---

## Task 4: QPay HTTP client (transport + token cache)

**Files:**
- Create: `src/libs/qpay/qpay-client.ts`
- Test: `tests/qpay-client.test.ts`

**Interfaces:**
- Consumes: `config.qpay` (Task 1), `redisClient` from `@/database/redis` (methods `get(key)`, `set(key, value, ttlSeconds?)`).
- Produces:
  - `getAccessToken(): Promise<string>`
  - `createInvoice(params: CreateInvoiceParams): Promise<QpayInvoiceResponse>`
  - `checkPayment(invoiceId: string): Promise<QpayPaymentCheckResponse>`
  - `cancelInvoice(invoiceId: string): Promise<void>`
  - Types: `CreateInvoiceParams { senderInvoiceNo: string; amount: number; description: string; callbackUrl: string }`; `QpayInvoiceResponse { invoiceId: string; qrText: string; qrImage: string; shortUrl?: string; deeplinks: Array<{ name: string; description: string; logo: string; link: string }>; raw: unknown }`; `QpayPaymentCheckResponse { count: number; paidAmount: number; rows: Array<{ paymentId: string; paymentStatus: string; paymentAmount: number }>; raw: unknown }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/qpay-client.test.ts
jest.mock('@/database/redis', () => ({
  redisClient: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true) },
}));

import { redisClient } from '@/database/redis';
import { getAccessToken, createInvoice } from '@/libs/qpay/qpay-client';

const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

beforeEach(() => {
  fetchMock.mockReset();
  (redisClient.get as jest.Mock).mockResolvedValue(null);
});

describe('qpay-client', () => {
  it('fetches a token with Basic auth and caches it in redis', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok123', refresh_token: 'ref', expires_in: 3600 }),
    });

    const token = await getAccessToken();

    expect(token).toBe('tok123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/auth/token');
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(redisClient.set).toHaveBeenCalledWith('qpay:token', 'tok123', expect.any(Number));
  });

  it('returns the cached token without calling fetch', async () => {
    (redisClient.get as jest.Mock).mockResolvedValue('cachedTok');
    const token = await getAccessToken();
    expect(token).toBe('cachedTok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates an invoice and normalizes the response', async () => {
    (redisClient.get as jest.Mock).mockResolvedValue('cachedTok');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invoice_id: 'inv-1',
        qr_text: 'QRDATA',
        qr_image: 'base64img',
        qPay_shortUrl: 'https://s.qpay.mn/x',
        urls: [{ name: 'khan', description: 'Khan', logo: 'l', link: 'khan://pay' }],
      }),
    });

    const res = await createInvoice({
      senderInvoiceNo: 'MEC-1', amount: 1000, description: 'Order MEC-1', callbackUrl: 'https://x/cb',
    });

    expect(res.invoiceId).toBe('inv-1');
    expect(res.qrText).toBe('QRDATA');
    expect(res.deeplinks[0].link).toBe('khan://pay');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sender_invoice_no).toBe('MEC-1');
    expect(body.callback_url).toBe('https://x/cb');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/qpay-client.test.ts -v`
Expected: FAIL — module `@/libs/qpay/qpay-client` not found.

- [ ] **Step 3: Implement the client**

```typescript
// src/libs/qpay/qpay-client.ts
import { z } from 'zod';
import { config } from '@/config';
import { redisClient } from '@/database/redis';
import { createLogger } from '@/utils/logger';

const logger = createLogger('QPAY');

const TOKEN_CACHE_KEY = 'qpay:token';
const TOKEN_SAFETY_BUFFER_SECONDS = 60;

export interface CreateInvoiceParams {
  senderInvoiceNo: string;
  amount: number;
  description: string;
  callbackUrl: string;
}

export interface QpayInvoiceResponse {
  invoiceId: string;
  qrText: string;
  qrImage: string;
  shortUrl?: string;
  deeplinks: Array<{ name: string; description: string; logo: string; link: string }>;
  raw: unknown;
}

export interface QpayPaymentCheckResponse {
  count: number;
  paidAmount: number;
  rows: Array<{ paymentId: string; paymentStatus: string; paymentAmount: number }>;
  raw: unknown;
}

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

const invoiceSchema = z.object({
  invoice_id: z.string(),
  qr_text: z.string(),
  qr_image: z.string(),
  qPay_shortUrl: z.string().optional(),
  urls: z
    .array(z.object({ name: z.string(), description: z.string(), logo: z.string(), link: z.string() }))
    .default([]),
});

const paymentCheckSchema = z.object({
  count: z.number(),
  paid_amount: z.number().optional().default(0),
  rows: z
    .array(z.object({
      payment_id: z.string(),
      payment_status: z.string(),
      payment_amount: z.union([z.string(), z.number()]).optional(),
    }))
    .default([]),
});

function baseHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function qpayFetch(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${config.qpay.baseUrl}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error(`QPay ${path} failed: ${res.status}`);
    throw new Error(`QPay request failed (${res.status}) on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function getAccessToken(): Promise<string> {
  const cached = await redisClient.get(TOKEN_CACHE_KEY).catch(() => null);
  if (cached) return cached;

  const basic = Buffer.from(`${config.qpay.clientId}:${config.qpay.clientSecret}`).toString('base64');
  const json = await qpayFetch('/v2/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
  });
  const parsed = tokenSchema.parse(json);
  const ttl = Math.max(parsed.expires_in - TOKEN_SAFETY_BUFFER_SECONDS, 30);
  await redisClient.set(TOKEN_CACHE_KEY, parsed.access_token, ttl).catch(() => false);
  return parsed.access_token;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<QpayInvoiceResponse> {
  const token = await getAccessToken();
  const json = await qpayFetch('/v2/invoice', {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({
      invoice_code: config.qpay.invoiceCode,
      sender_invoice_no: params.senderInvoiceNo,
      invoice_receiver_code: 'terminal',
      invoice_description: params.description,
      amount: params.amount,
      callback_url: params.callbackUrl,
    }),
  });
  const parsed = invoiceSchema.parse(json);
  return {
    invoiceId: parsed.invoice_id,
    qrText: parsed.qr_text,
    qrImage: parsed.qr_image,
    shortUrl: parsed.qPay_shortUrl,
    deeplinks: parsed.urls,
    raw: json,
  };
}

export async function checkPayment(invoiceId: string): Promise<QpayPaymentCheckResponse> {
  const token = await getAccessToken();
  const json = await qpayFetch('/v2/payment/check', {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
      offset: { page_number: 1, page_limit: 100 },
    }),
  });
  const parsed = paymentCheckSchema.parse(json);
  return {
    count: parsed.count,
    paidAmount: parsed.paid_amount,
    rows: parsed.rows.map((r) => ({
      paymentId: r.payment_id,
      paymentStatus: r.payment_status,
      paymentAmount: Number(r.payment_amount ?? 0),
    })),
    raw: json,
  };
}

export async function cancelInvoice(invoiceId: string): Promise<void> {
  const token = await getAccessToken();
  await qpayFetch(`/v2/invoice/${invoiceId}`, { method: 'DELETE', headers: baseHeaders(token) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/qpay-client.test.ts -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/libs/qpay/qpay-client.ts tests/qpay-client.test.ts
git commit -m "feat(qpay): add QPay HTTP client with Redis token cache"
```

---

## Task 5: Callback token (HMAC) + payment service

**Files:**
- Create: `src/libs/qpay/callback-token.ts`
- Create: `src/libs/qpay/qpay-service.ts`
- Test: `tests/qpay-callback-token.test.ts`, `tests/qpay-service.test.ts`

**Interfaces:**
- Consumes: `qpay-client` (Task 4), `config.qpay`, `context.prisma`.
- Produces:
  - `signOrderRef(orderId: string): string` and `verifyOrderRef(orderId: string, token: string): boolean` (from `callback-token.ts`).
  - `createInvoiceForOrder(prisma, order): Promise<PaymentDisplay>` where `order` has `{ id, orderNumber, total, currency, tenantId, status }` and `PaymentDisplay = { orderId: string; invoiceId: string; qrText: string; qrImage: string; shortUrl?: string; deeplinks: unknown; amount: number; currency: string; status: string }`.
  - `confirmPayment(prisma, orderId: string): Promise<void>`.
  - `expireIfLapsed(prisma, orderId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test for the callback token**

```typescript
// tests/qpay-callback-token.test.ts
jest.mock('@/config', () => ({ config: { qpay: { callbackSecret: 'testsecret' } } }));
import { signOrderRef, verifyOrderRef } from '@/libs/qpay/callback-token';

describe('callback-token', () => {
  it('signs and verifies an order ref', () => {
    const token = signOrderRef('order-1');
    expect(verifyOrderRef('order-1', token)).toBe(true);
  });
  it('rejects a tampered token', () => {
    expect(verifyOrderRef('order-1', 'bogus')).toBe(false);
  });
  it('rejects a token for a different order', () => {
    const token = signOrderRef('order-1');
    expect(verifyOrderRef('order-2', token)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/qpay-callback-token.test.ts -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the callback token**

```typescript
// src/libs/qpay/callback-token.ts
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '@/config';

export function signOrderRef(orderId: string): string {
  return createHmac('sha256', config.qpay.callbackSecret).update(orderId).digest('hex');
}

export function verifyOrderRef(orderId: string, token: string): boolean {
  const expected = signOrderRef(orderId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/qpay-callback-token.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Write the failing service test**

```typescript
// tests/qpay-service.test.ts
jest.mock('@/config', () => ({
  config: { qpay: { callbackSecret: 's', callbackBaseUrl: 'https://api.x', invoiceTtlMinutes: 30 } },
}));
jest.mock('@/libs/qpay/qpay-client', () => ({
  createInvoice: jest.fn(),
  checkPayment: jest.fn(),
  cancelInvoice: jest.fn(),
}));

import * as client from '@/libs/qpay/qpay-client';
import { createInvoiceForOrder, confirmPayment, expireIfLapsed } from '@/libs/qpay/qpay-service';

function makePrisma() {
  const payment = { id: 'pay-1', orderId: 'order-1', qpayInvoiceId: 'inv-1', status: 'PENDING', amount: 1000, expiresAt: new Date(Date.now() + 60000) };
  return {
    _payment: payment,
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue({ ...payment, status: 'PAID' }),
    },
    merchOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: 'order-1', status: 'AWAITING_PAYMENT' }),
      update: jest.fn().mockResolvedValue({ id: 'order-1', status: 'PAID' }),
    },
    merchOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
    merchProduct: { update: jest.fn().mockResolvedValue({}) },
  } as any;
}

const order = { id: 'order-1', orderNumber: 'MEC-1', total: 1000, currency: 'MNT', tenantId: 't1', status: 'AWAITING_PAYMENT' };

describe('qpay-service', () => {
  it('creates an invoice, persists a Payment, returns display data', async () => {
    (client.createInvoice as jest.Mock).mockResolvedValue({
      invoiceId: 'inv-1', qrText: 'QR', qrImage: 'img', shortUrl: 's', deeplinks: [], raw: {},
    });
    const prisma = makePrisma();
    const res = await createInvoiceForOrder(prisma, order);
    expect(res.invoiceId).toBe('inv-1');
    expect(res.qrText).toBe('QR');
    expect(prisma.payment.create).toHaveBeenCalled();
    const callbackUrl = (client.createInvoice as jest.Mock).mock.calls[0][0].callbackUrl;
    expect(callbackUrl).toContain('order-1');
    expect(callbackUrl).toContain('token=');
  });

  it('confirmPayment marks order PAID when QPay reports paid', async () => {
    (client.checkPayment as jest.Mock).mockResolvedValue({ count: 1, paidAmount: 1000, rows: [{ paymentId: 'p9', paymentStatus: 'PAID', paymentAmount: 1000 }], raw: {} });
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue(prisma._payment);
    await confirmPayment(prisma, 'order-1');
    expect(prisma.merchOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }));
  });

  it('confirmPayment is a no-op when QPay reports unpaid', async () => {
    (client.checkPayment as jest.Mock).mockResolvedValue({ count: 0, paidAmount: 0, rows: [], raw: {} });
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue(prisma._payment);
    await confirmPayment(prisma, 'order-1');
    expect(prisma.merchOrder.update).not.toHaveBeenCalled();
  });

  it('expireIfLapsed cancels the invoice and expires order past TTL', async () => {
    const prisma = makePrisma();
    prisma.payment.findFirst.mockResolvedValue({ ...prisma._payment, expiresAt: new Date(Date.now() - 1000) });
    await expireIfLapsed(prisma, 'order-1');
    expect(client.cancelInvoice).toHaveBeenCalledWith('inv-1');
    expect(prisma.merchOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }));
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tests/qpay-service.test.ts -v`
Expected: FAIL — module `@/libs/qpay/qpay-service` not found.

- [ ] **Step 7: Implement the service**

```typescript
// src/libs/qpay/qpay-service.ts
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { createInvoice, checkPayment, cancelInvoice } from '@/libs/qpay/qpay-client';
import { signOrderRef } from '@/libs/qpay/callback-token';

const logger = createLogger('QPAY_SERVICE');

export interface PaymentDisplay {
  orderId: string;
  invoiceId: string;
  qrText: string;
  qrImage: string;
  shortUrl?: string;
  deeplinks: unknown;
  amount: number;
  currency: string;
  status: string;
}

interface OrderLike {
  id: string;
  orderNumber: string;
  total: number;
  currency: string;
  tenantId: string;
  status: string;
}

function buildCallbackUrl(orderId: string): string {
  const token = signOrderRef(orderId);
  const base = config.qpay.callbackBaseUrl.replace(/\/$/, '');
  return `${base}/api/payments/qpay/callback?order=${encodeURIComponent(orderId)}&token=${token}`;
}

export async function createInvoiceForOrder(prisma: any, order: OrderLike): Promise<PaymentDisplay> {
  if (order.status === 'PAID') throw new Error('Order is already paid');

  // Idempotent: reuse a live pending invoice if one exists and has not lapsed.
  const existing = await prisma.payment.findFirst({
    where: { orderId: order.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (existing && (!existing.expiresAt || existing.expiresAt > new Date()) && existing.qpayInvoiceId) {
    return {
      orderId: order.id,
      invoiceId: existing.qpayInvoiceId,
      qrText: existing.qrText ?? '',
      qrImage: existing.qrImage ?? '',
      shortUrl: existing.shortUrl ?? undefined,
      deeplinks: existing.deeplinks ?? [],
      amount: existing.amount,
      currency: existing.currency,
      status: existing.status,
    };
  }

  const invoice = await createInvoice({
    senderInvoiceNo: order.orderNumber,
    amount: order.total,
    description: `Order ${order.orderNumber}`,
    callbackUrl: buildCallbackUrl(order.id),
  });

  const expiresAt = new Date(Date.now() + config.qpay.invoiceTtlMinutes * 60_000);
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      tenantId: order.tenantId,
      provider: 'QPAY',
      senderInvoiceNo: order.orderNumber,
      qpayInvoiceId: invoice.invoiceId,
      amount: order.total,
      currency: order.currency,
      status: 'PENDING',
      qrText: invoice.qrText,
      qrImage: invoice.qrImage,
      shortUrl: invoice.shortUrl ?? null,
      deeplinks: invoice.deeplinks as any,
      invoiceResponse: invoice.raw as any,
      expiresAt,
    },
  });

  logger.info(`Created QPay invoice ${invoice.invoiceId} for order ${order.orderNumber}`);
  return {
    orderId: order.id,
    invoiceId: invoice.invoiceId,
    qrText: invoice.qrText,
    qrImage: invoice.qrImage,
    shortUrl: invoice.shortUrl,
    deeplinks: invoice.deeplinks,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
  };
}

export async function confirmPayment(prisma: any, orderId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: { in: ['PENDING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment || !payment.qpayInvoiceId) {
    logger.warn(`confirmPayment: no pending payment for order ${orderId}`);
    return;
  }

  const check = await checkPayment(payment.qpayInvoiceId);
  const paidRow = check.rows.find((r) => r.paymentStatus?.toUpperCase() === 'PAID');
  if (check.count < 1 || !paidRow) {
    logger.info(`confirmPayment: order ${orderId} not paid yet`);
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      qpayPaymentId: paidRow.paymentId,
      paidAmount: check.paidAmount,
      paidAt: new Date(),
      callbackPayload: check.raw as any,
    },
  });
  await prisma.merchOrder.update({ where: { id: orderId }, data: { status: 'PAID' } });
  logger.info(`Order ${orderId} confirmed PAID (payment ${paidRow.paymentId})`);
}

export async function expireIfLapsed(prisma: any, orderId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment || !payment.expiresAt || payment.expiresAt > new Date()) return;

  if (payment.qpayInvoiceId) {
    await cancelInvoice(payment.qpayInvoiceId).catch((e) =>
      logger.warn(`Failed to cancel expired invoice ${payment.qpayInvoiceId}: ${String(e)}`)
    );
  }

  // Restore inventory for tracked products on this order.
  const items = await prisma.merchOrderItem.findMany({ where: { orderId } });
  for (const item of items) {
    await prisma.merchProduct
      .update({ where: { id: item.productId }, data: { inventory: { increment: item.quantity } } })
      .catch(() => undefined);
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
  await prisma.merchOrder.update({ where: { id: orderId }, data: { status: 'EXPIRED' } });
  logger.info(`Order ${orderId} expired (invoice ${payment.qpayInvoiceId ?? 'n/a'})`);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest tests/qpay-service.test.ts tests/qpay-callback-token.test.ts -v`
Expected: PASS (all).

- [ ] **Step 9: Commit**

```bash
git add src/libs/qpay/callback-token.ts src/libs/qpay/qpay-service.ts tests/qpay-callback-token.test.ts tests/qpay-service.test.ts
git commit -m "feat(qpay): add HMAC callback token and payment orchestration service"
```

---

## Task 6: GraphQL API — createQpayInvoice + merchOrderPaymentStatus

**Files:**
- Create: `src/graphql/schema/payment/index.ts`
- Modify: `src/graphql/schema/index.ts` (register `paymentSchema`)
- Create: `src/graphql/resolvers/mutations/payment.ts`, `src/graphql/resolvers/queries/payment.ts`
- Modify: `src/graphql/resolvers/index.ts` (register payment resolvers + `MerchOrder.payments` field resolver)
- Test: `tests/qpay-resolvers.test.ts`

**Interfaces:**
- Consumes: `createInvoiceForOrder`, `expireIfLapsed` (Task 5); `NotFoundError`, `ValidationError` from `@/utils/errors`.
- Produces GraphQL ops:
  - `createQpayInvoice(orderId: ID!): QpayInvoice!`
  - `merchOrderPaymentStatus(orderId: ID!): PaymentStatusResult!`

- [ ] **Step 1: Write the failing resolver test**

```typescript
// tests/qpay-resolvers.test.ts
jest.mock('@/libs/qpay/qpay-service', () => ({
  createInvoiceForOrder: jest.fn(),
  expireIfLapsed: jest.fn().mockResolvedValue(undefined),
}));
import * as svc from '@/libs/qpay/qpay-service';
import { paymentMutations } from '@/graphql/resolvers/mutations/payment';
import { paymentQueries } from '@/graphql/resolvers/queries/payment';

function ctx(order: any) {
  return { prisma: { merchOrder: { findUnique: jest.fn().mockResolvedValue(order) } } } as any;
}

describe('qpay resolvers', () => {
  it('createQpayInvoice returns invoice display data', async () => {
    (svc.createInvoiceForOrder as jest.Mock).mockResolvedValue({
      orderId: 'o1', invoiceId: 'inv', qrText: 'QR', qrImage: 'img', shortUrl: 's', deeplinks: [], amount: 1000, currency: 'MNT', status: 'PENDING',
    });
    const res = await paymentMutations.createQpayInvoice(null, { orderId: 'o1' }, ctx({ id: 'o1', status: 'AWAITING_PAYMENT' }));
    expect(res.invoiceId).toBe('inv');
  });

  it('createQpayInvoice throws when order missing', async () => {
    await expect(
      paymentMutations.createQpayInvoice(null, { orderId: 'nope' }, ctx(null))
    ).rejects.toThrow();
  });

  it('merchOrderPaymentStatus returns status from our DB', async () => {
    const context = { prisma: { merchOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', status: 'PAID' }) }, payment: { findFirst: jest.fn().mockResolvedValue({ paidAt: new Date() }) } } } as any;
    const res = await paymentQueries.merchOrderPaymentStatus(null, { orderId: 'o1' }, context);
    expect(res.status).toBe('PAID');
    expect(svc.expireIfLapsed).toHaveBeenCalledWith(context.prisma, 'o1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/qpay-resolvers.test.ts -v`
Expected: FAIL — resolver modules not found.

- [ ] **Step 3: Add the payment GraphQL schema**

```typescript
// src/graphql/schema/payment/index.ts
import gql from 'graphql-tag';

export const paymentSchema = gql`
  type Payment {
    id: ID!
    orderId: String!
    provider: String!
    status: String!
    amount: Float!
    currency: String!
    qpayInvoiceId: String
    qpayPaymentId: String
    paidAt: DateTime
    createdAt: DateTime!
  }

  type QpayInvoiceDeeplink {
    name: String!
    description: String!
    logo: String!
    link: String!
  }

  type QpayInvoice {
    orderId: ID!
    invoiceId: String!
    qrText: String!
    qrImage: String!
    shortUrl: String
    deeplinks: [QpayInvoiceDeeplink!]!
    amount: Float!
    currency: String!
    status: String!
  }

  type PaymentStatusResult {
    orderId: ID!
    status: String!
    paidAt: DateTime
  }

  extend type Mutation {
    createQpayInvoice(orderId: ID!): QpayInvoice!
  }

  extend type Query {
    merchOrderPaymentStatus(orderId: ID!): PaymentStatusResult!
  }
`;
```

- [ ] **Step 4: Register the schema**

In `src/graphql/schema/index.ts`, import `paymentSchema` and add it to the `typeDefs` array alongside `orderSchema`.

```typescript
import { paymentSchema } from './payment';
// ...add paymentSchema to the exported typeDefs list
```

- [ ] **Step 5: Implement the mutation resolver**

```typescript
// src/graphql/resolvers/mutations/payment.ts
import { GraphQLContext } from '@/types';
import { NotFoundError, ValidationError } from '@/utils/errors';
import { createInvoiceForOrder } from '@/libs/qpay/qpay-service';

export const createQpayInvoice = async (
  _parent: unknown,
  args: { orderId: string },
  context: GraphQLContext
) => {
  const order = await context.prisma.merchOrder.findUnique({ where: { id: args.orderId } });
  if (!order) throw new NotFoundError('Order');
  if (order.status === 'PAID') throw new ValidationError('Order is already paid');
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') {
    throw new ValidationError('Order can no longer be paid');
  }
  return createInvoiceForOrder(context.prisma, order as any);
};

export const paymentMutations = { createQpayInvoice };
```

- [ ] **Step 6: Implement the query resolver**

```typescript
// src/graphql/resolvers/queries/payment.ts
import { GraphQLContext } from '@/types';
import { NotFoundError } from '@/utils/errors';
import { expireIfLapsed } from '@/libs/qpay/qpay-service';

export const merchOrderPaymentStatus = async (
  _parent: unknown,
  args: { orderId: string },
  context: GraphQLContext
) => {
  await expireIfLapsed(context.prisma, args.orderId);
  const order = await context.prisma.merchOrder.findUnique({ where: { id: args.orderId } });
  if (!order) throw new NotFoundError('Order');
  const paid = await context.prisma.payment.findFirst({
    where: { orderId: args.orderId, status: 'PAID' },
    orderBy: { paidAt: 'desc' },
  });
  return { orderId: order.id, status: order.status, paidAt: paid?.paidAt ?? null };
};

export const paymentQueries = { merchOrderPaymentStatus };
```

- [ ] **Step 7: Wire resolvers into the aggregate**

In `src/graphql/resolvers/index.ts`: import `paymentMutations` and `paymentQueries`, spread them into the `Mutation` and `Query` resolver maps, and add a `MerchOrder` type resolver for `payments`:

```typescript
import { paymentMutations } from './mutations/payment';
import { paymentQueries } from './queries/payment';
// In Query: ...paymentQueries,
// In Mutation: ...paymentMutations,
// Add a MerchOrder field resolver (near other type resolvers):
//   MerchOrder: {
//     payments: (parent, _args, context) =>
//       context.prisma.payment.findMany({ where: { orderId: parent.id }, orderBy: { createdAt: 'desc' } }),
//   },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest tests/qpay-resolvers.test.ts -v`
Expected: PASS (3 tests).

- [ ] **Step 9: Type-check the whole project**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/graphql/schema/payment/index.ts src/graphql/schema/index.ts src/graphql/resolvers/mutations/payment.ts src/graphql/resolvers/queries/payment.ts src/graphql/resolvers/index.ts tests/qpay-resolvers.test.ts
git commit -m "feat(qpay): add createQpayInvoice mutation and payment status query"
```

---

## Task 7: Secured REST callback route

**Files:**
- Create: `src/routes/qpay-callback.ts`
- Modify: `src/server.ts` (mount router before the `/graphql` middleware, after `express.json`)
- Test: `tests/qpay-callback-route.test.ts`

**Interfaces:**
- Consumes: `verifyOrderRef` (Task 5), `confirmPayment` (Task 5), `prisma` from `@/database/prisma`.
- Produces: an Express `Router` mounted at `/api/payments/qpay`, handling `GET|POST /callback`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/qpay-callback-route.test.ts
jest.mock('@/libs/qpay/qpay-service', () => ({ confirmPayment: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/libs/qpay/callback-token', () => ({ verifyOrderRef: jest.fn() }));
jest.mock('@/database/prisma', () => ({ prisma: {} }));

import express from 'express';
import request from 'supertest';
import { qpayCallbackRouter } from '@/routes/qpay-callback';
import { verifyOrderRef } from '@/libs/qpay/callback-token';
import { confirmPayment } from '@/libs/qpay/qpay-service';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/payments/qpay', qpayCallbackRouter);
  return a;
}

describe('qpay callback route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a request with an invalid token', async () => {
    (verifyOrderRef as jest.Mock).mockReturnValue(false);
    const res = await request(app()).post('/api/payments/qpay/callback?order=o1&token=bad');
    expect(res.status).toBe(401);
    expect(confirmPayment).not.toHaveBeenCalled();
  });

  it('confirms payment on a valid token and returns 200', async () => {
    (verifyOrderRef as jest.Mock).mockReturnValue(true);
    const res = await request(app()).post('/api/payments/qpay/callback?order=o1&token=good');
    expect(res.status).toBe(200);
    expect(confirmPayment).toHaveBeenCalledWith(expect.anything(), 'o1');
  });
});
```

- [ ] **Step 2: Ensure `supertest` is available**

Run: `npm ls supertest || npm install --save-dev supertest @types/supertest`
Expected: `supertest` present (install if missing).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/qpay-callback-route.test.ts -v`
Expected: FAIL — router module not found.

- [ ] **Step 4: Implement the router**

```typescript
// src/routes/qpay-callback.ts
import { Router, Request, Response } from 'express';
import { prisma } from '@/database/prisma';
import { verifyOrderRef } from '@/libs/qpay/callback-token';
import { confirmPayment } from '@/libs/qpay/qpay-service';
import { createLogger } from '@/utils/logger';

const logger = createLogger('QPAY_CALLBACK');

async function handleCallback(req: Request, res: Response): Promise<void> {
  const orderId = String(req.query.order ?? '');
  const token = String(req.query.token ?? '');

  if (!orderId || !token || !verifyOrderRef(orderId, token)) {
    logger.warn(`Rejected QPay callback for order=${orderId} (bad token)`);
    res.status(401).json({ error: 'Invalid callback token' });
    return;
  }

  try {
    // Never trust the callback body — confirmPayment re-verifies with QPay.
    await confirmPayment(prisma as any, orderId);
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`QPay callback processing failed for order ${orderId}`, error as Error);
    // Still 200 so QPay does not spam retries; we log for manual follow-up.
    res.status(200).json({ received: true });
  }
}

export const qpayCallbackRouter = Router();
qpayCallbackRouter.post('/callback', handleCallback);
qpayCallbackRouter.get('/callback', handleCallback);
```

- [ ] **Step 5: Mount the router in `server.ts`**

In `src/server.ts`, after `this.app.use(express.json(...))` and `express.urlencoded(...)` (around line 190) and before the `/graphql` middleware, add:

```typescript
import { qpayCallbackRouter } from '@/routes/qpay-callback';
// ...inside the middleware setup:
this.app.use('/api/payments/qpay', qpayCallbackRouter);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/qpay-callback-route.test.ts -v`
Expected: PASS (2 tests).

- [ ] **Step 7: Full test + type-check**

Run: `npm test`
Then: `npm run type-check`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/routes/qpay-callback.ts src/server.ts tests/qpay-callback-route.test.ts package.json package-lock.json
git commit -m "feat(qpay): add secured REST callback route for payment confirmation"
```

---

## Task 8: Sandbox end-to-end verification (manual)

**Files:**
- Create: `docs/QPAY_SANDBOX_TEST.md`

**Interfaces:** none (documentation + manual verification).

- [ ] **Step 1: Fill sandbox env**

Set in your local `.env`: `QPAY_BASE_URL=https://merchant-sandbox.qpay.mn`, `QPAY_CLIENT_ID`, `QPAY_CLIENT_SECRET`, `QPAY_INVOICE_CODE=MONGOLEC_ORG_INVOICE`, `QPAY_CALLBACK_BASE_URL=<public tunnel or domain>`, `QPAY_CALLBACK_SECRET=<random>`.

- [ ] **Step 2: Write the manual test checklist**

```markdown
# QPay sandbox test

1. Start backend: `npm run dev`.
2. Expose the callback publicly (e.g. an ngrok/cloudflared tunnel) and set QPAY_CALLBACK_BASE_URL to it.
3. GraphQL: run `createMerchOrder` → note the returned order `id` and `orderNumber`; status should be `AWAITING_PAYMENT`.
4. GraphQL: run `createQpayInvoice(orderId)` → confirm `qrText`, `qrImage`, and `deeplinks` come back.
5. Pay the invoice in the QPay sandbox app / test flow.
6. Confirm the callback hits `/api/payments/qpay/callback` (check logs).
7. GraphQL: run `merchOrderPaymentStatus(orderId)` → status should now be `PAID` with a `paidAt`.
8. Expiry: create another invoice, do NOT pay, wait past QPAY_INVOICE_TTL_MINUTES, poll `merchOrderPaymentStatus` → status should be `EXPIRED`, inventory restored, and the QPay invoice cancelled.
```

- [ ] **Step 3: Run the checklist and record results**

Perform each step above against the sandbox. Note any deviation (especially exact QPay response field names — adjust the Zod schemas in `qpay-client.ts` if the sandbox returns different casing).

- [ ] **Step 4: Commit**

```bash
git add docs/QPAY_SANDBOX_TEST.md
git commit -m "docs(qpay): add sandbox end-to-end test checklist"
```

---

## Self-Review notes

- **Spec coverage:** Config (Task 1) ✓; Payment model + statuses + migration (Task 2) ✓; order lifecycle + remove bank transfer (Task 3) ✓; client with token cache (Task 4) ✓; service create/confirm/expire + HMAC (Task 5) ✓; GraphQL create/status + admin `payments` (Task 6) ✓; secured REST callback (Task 7) ✓; sandbox verification (Task 8) ✓. eBarimt/refund/multi-currency correctly excluded.
- **Type consistency:** `createInvoiceForOrder`, `confirmPayment`, `expireIfLapsed`, `signOrderRef`/`verifyOrderRef`, `getAccessToken`/`createInvoice`/`checkPayment`/`cancelInvoice` names are used identically across tasks. `PaymentDisplay` fields match the `QpayInvoice` GraphQL type.
- **Known follow-up:** exact QPay sandbox response casing is verified in Task 8 and Zod schemas adjusted if needed; frontend checkout rework (render QR, poll status, drop bank UI) is a separate plan.
