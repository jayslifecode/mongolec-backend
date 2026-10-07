# QPay V2 Payment Integration — Design

**Date:** 2026-08-06
**Project:** mongolec-backend
**Status:** Approved for planning
**Scope:** Backend only. Frontend wiring is a follow-up phase.

## 1. Goal

Integrate the QPay V2 Merchant API so merch customers pay by QR / bank-app
deeplink instead of the manual bank-transfer + "I've paid" flow. All QPay
communication (credentials, token, invoice creation, payment verification)
happens **server-side only**. The frontend never sees QPay credentials and
never calls QPay directly — it only receives display-safe data (QR image,
deeplinks) and polls our own database for status.

QPay eBarimt (tax receipt) is **out of scope** — the merchant account does not
have it enabled.

## 2. Key decisions

1. **Order created upfront.** `createMerchOrder` still creates the `MerchOrder`
   immediately, now with status `AWAITING_PAYMENT`. Inventory is decremented at
   creation (unchanged). The verified QPay callback flips the order to `PAID`.
2. **QPay replaces manual bank transfer.** The `markMerchOrderPaid` mutation and
   the hardcoded bank-account checkout path are removed. `paymentMethod` defaults
   to `"QPAY"`.
3. **Simple expiry, owned by us.** QPay V2 invoices do not auto-expire; the QR
   stays payable until cancelled. We set our own TTL (default 30 min). On lapse:
   `Payment → EXPIRED`, `Order → EXPIRED`, inventory restored, and the QPay
   invoice cancelled via `DELETE /v2/invoice/{invoice_id}` so it cannot be paid
   late. Records are kept, not deleted.

## 3. QPay V2 reference (confirmed from developer.qpay.mn)

- **Base URLs:** Sandbox `https://merchant-sandbox.qpay.mn`,
  Production `https://merchant.qpay.mn`. Same API — flip via one env var.
- **Auth:** `POST /v2/auth/token` with `Authorization: Basic base64(client_id:client_secret)`
  → `{ access_token, refresh_token, expires_in, ... }`. Refresh via
  `POST /v2/auth/refresh` (`Authorization: Bearer {refresh_token}`). QPay warns
  against re-fetching tokens too frequently → cache in Redis.
- **Create invoice:** `POST /v2/invoice` with `invoice_code`, unique
  `sender_invoice_no`, `amount`, `invoice_description`, `callback_url` →
  `{ invoice_id, qr_text, qr_image, qPay_shortUrl, urls: [{name, description, logo, link}] }`.
- **Cancel invoice:** `DELETE /v2/invoice/{invoice_id}`.
- **Verify payment:** `POST /v2/payment/check` with
  `{ object_type: "INVOICE", object_id: invoice_id, offset: { page_number, page_limit } }`
  → `{ count, paid_amount, rows: [{ payment_id, payment_status, payment_amount, ... }] }`.
- **Callback:** QPay calls our `callback_url` (plain HTTP) when payment
  completes. We then call `payment/check` to verify before trusting it. Cron /
  frequent polling of QPay is forbidden — callback-driven only.

## 4. Data model (Prisma, additive migration)

New model:

```prisma
model Payment {
  id              String        @id @default(cuid())
  orderId         String
  order           MerchOrder    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  tenantId        String
  provider        String        @default("QPAY")

  senderInvoiceNo String        @unique   // what we send QPay (order-scoped, unique)
  qpayInvoiceId   String?       @unique   // invoice_id from QPay
  qpayPaymentId   String?                 // payment_id after payment

  amount          Float
  currency        String        @default("MNT")
  paidAmount      Float?

  status          PaymentStatus @default(PENDING)

  qrText          String?
  qrImage         String?
  shortUrl        String?
  deeplinks       Json?         // [{name, description, logo, link}]

  invoiceResponse Json?         // raw create-invoice response
  callbackPayload Json?         // raw callback + payment/check response

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

`MerchOrder` changes (additive):

- Add relation `payments Payment[]`.
- Extend `MerchOrderStatus` with `AWAITING_PAYMENT`, `PAID`, `EXPIRED`.
- New orders start `AWAITING_PAYMENT`; `paymentMethod` default → `"QPAY"`.
- Keep deprecated `paymentClaimedAt` column (no data loss).

Migration is a hand-written additive SQL file alongside the existing ones in
`migrations/`, matching the project's current migration style.

## 5. Service layer — `src/libs/qpay/`

### `qpay-client.ts` (transport)
- `getAccessToken()` — Basic auth; caches `access_token` in Redis under
  `qpay:token` with TTL = `expires_in - 60s`; uses `refresh_token` when possible;
  degrades to a fresh token if Redis is unavailable (matches existing Redis
  fallback pattern).
- `createInvoice(params)`, `checkPayment(invoiceId)`, `cancelInvoice(invoiceId)`.
- Config from env (Section 7). Responses validated with Zod. Winston logging via
  `createLogger('QPAY')`. No secrets logged.

### `qpay-service.ts` (orchestration)
- `createInvoiceForOrder(order)` — guards order is `AWAITING_PAYMENT` and unpaid;
  reuses an existing live `Payment` if present (idempotent); builds
  `sender_invoice_no` from `order.orderNumber` and a signed `callback_url`; calls
  the client; persists the `Payment` row with `expiresAt`; returns display data.
- `confirmPayment(ref)` — loads the `Payment`, calls `payment/check` as the
  source of truth, and **idempotently** sets `Payment → PAID` + `Order → PAID`
  (a second callback is a no-op). Rejects if QPay reports unpaid.
- `expireIfLapsed(payment)` — if past `expiresAt` and still `PENDING`: cancel the
  QPay invoice, set `Payment → EXPIRED` + `Order → EXPIRED`, restore inventory.

## 6. GraphQL & REST API

### GraphQL (guest-callable, mirrors current guest order pattern)
- **Mutation** `createQpayInvoice(orderId: ID!): QpayInvoice!`
  → `{ orderId, invoiceId, qrText, qrImage, shortUrl, deeplinks, amount, currency, status }`.
- **Query** `merchOrderPaymentStatus(orderId: ID!): PaymentStatusResult!`
  → `{ orderId, status, paidAt }`. Frontend polls **our DB**, never QPay. This
  resolver also runs `expireIfLapsed` lazily.
- **Admin:** add `payments: [Payment!]!` to the `MerchOrder` type so admins see
  invoice id + status. Reuses existing `merch:read` permission.
- **Removed:** `markMerchOrderPaid`.

### REST callback (QPay hits a plain URL, so not GraphQL)
- **`POST /api/payments/qpay/callback`** (also accept `GET` — QPay
  implementations vary), registered in `server.ts`.
- Public but secured two ways: (a) an HMAC token embedded in `callback_url`
  (`QPAY_CALLBACK_SECRET`) validated on hit; (b) never trust the callback body —
  call `payment/check` against QPay before marking paid.
- Idempotent; responds `200` quickly.

## 7. Configuration (env)

```
QPAY_BASE_URL=https://merchant-sandbox.qpay.mn   # prod: https://merchant.qpay.mn
QPAY_CLIENT_ID=MONGOLEC_ORG
QPAY_CLIENT_SECRET=<secret>                        # never in DB/frontend; rotate before go-live
QPAY_INVOICE_CODE=MONGOLEC_ORG_INVOICE
QPAY_CALLBACK_BASE_URL=https://<public-backend-domain>   # e.g. api.mongolec.org
QPAY_CALLBACK_SECRET=<random>
QPAY_INVOICE_TTL_MINUTES=30
```

Added to `.env.example` (values redacted). Start on sandbox; production =
change base URL + real credentials.

**Prerequisite:** the callback needs a publicly reachable HTTPS URL. The backend
binds to `127.0.0.1:4000` behind nginx, so the callback routes through the
public domain. Confirm the domain at deploy time.

## 8. Testing

- **Unit (mock fetch/Redis):** token caching + refresh; invoice payload shape;
  `payment/check` parsing; `confirmPayment` idempotency (double callback =
  no-op); verify-before-trust (unpaid check rejects); `expireIfLapsed` restores
  inventory + cancels invoice.
- **Resolver:** `createQpayInvoice` happy path, already-paid guard, idempotent
  reuse of a live invoice; `merchOrderPaymentStatus` including lazy expiry.
- **Callback route:** HMAC validation, verify-before-trust, idempotency.
- **Sandbox manual test plan:** real token → create invoice → pay in QPay
  sandbox → observe callback → order flips to `PAID`.

## 9. Out of scope (this spec)

- eBarimt (`/v2/ebarimt_v3/*`).
- Card refunds/cancels (`/v2/payment/refund`, `/v2/payment/cancel`) — schema and
  client leave room, but no resolver yet.
- Frontend checkout rework (render QR, poll status, drop bank-account UI) — a
  small follow-up phase consuming `createQpayInvoice` + `merchOrderPaymentStatus`.
- Multi-currency (MNT only, matching current storefront).
