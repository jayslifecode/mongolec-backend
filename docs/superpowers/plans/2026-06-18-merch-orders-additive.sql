-- CreateEnum
CREATE TYPE "MerchOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "merch_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "notes" TEXT,
    "status" "MerchOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MNT',
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merch_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merch_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "variantId" TEXT,
    "variantName" TEXT,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "merch_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merch_orders_orderNumber_key" ON "merch_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "merch_orders_tenantId_idx" ON "merch_orders"("tenantId");

-- CreateIndex
CREATE INDEX "merch_orders_status_idx" ON "merch_orders"("status");

-- CreateIndex
CREATE INDEX "merch_order_items_orderId_idx" ON "merch_order_items"("orderId");

-- AddForeignKey
ALTER TABLE "merch_order_items" ADD CONSTRAINT "merch_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merch_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

