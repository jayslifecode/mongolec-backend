-- Additive: capture useful QPay transaction details on payments. Safe on prod.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "fee"               DOUBLE PRECISION;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "netAmount"         DOUBLE PRECISION;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "paymentWallet"     TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "paymentType"       TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settlementStatus"  TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "ebarimtCustomerNo" TEXT;
