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
