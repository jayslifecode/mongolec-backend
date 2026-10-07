-- AlterTable
ALTER TABLE "merch_orders" ADD COLUMN     "deliveryMethod" TEXT NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "paymentClaimedAt" TIMESTAMP(3);

