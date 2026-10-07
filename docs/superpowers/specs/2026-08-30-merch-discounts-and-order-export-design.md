# Merch Discounts + Orders Excel Export — Design

**Date:** 2026-08-30
**Status:** Approved design, pending implementation plan
**Repos touched:** `mongolec-backend` (data model + API), `mongolec-admin` (management UI), `mec-merch` (storefront display)

## 1. Overview & Goals

Two independent merch features:

1. **Discounts** — a first-class, admin-managed discount entity (percent or fixed amount, with a start/end date window) that can be attached to many products. When active, the discount reduces the price charged at checkout and is shown on the storefront.
2. **Orders Excel export** — a backend-generated `.xlsx` of orders, downloadable from the admin Orders page, scoped by date-range presets or the rows currently shown.

### Non-goals (YAGNI)
- Coupon codes / customer-entered codes.
- Per-customer or per-order-total discounts (cart-level, BOGO, free shipping).
- Stacking multiple discounts.
- Per-variant discount attachment (discounts attach to whole products; variants inherit).
- Streaming/huge-file export (base64 over GraphQL is fine for expected volumes).

## 2. Discounts

### 2.1 Data model (Prisma, `mongolec-backend`)

New model `MerchDiscount`:
- `id` (cuid), `name` (String, admin label e.g. "Summer discount")
- `type` — enum `MerchDiscountType { PERCENT, AMOUNT }`
- `value` (Float) — percent (0–100) or fixed amount in the product's currency
- `startDate` (DateTime), `endDate` (DateTime)
- `isActive` (Boolean, default true) — manual master switch, ANDed with the date window
- `tenantId` (String) + Tenant relation, tenant-scoped like products
- `products` — implicit many-to-many `MerchProduct[]`
- `createdAt`, `updatedAt`, `deletedAt` (soft delete, matching merch convention)

Changes to existing models:
- `MerchProduct`: add `discounts MerchDiscount[]` (other side of the m2m).
- `MerchOrder`: add `discountTotal Float @default(0)`.
- `MerchOrderItem`: add `originalUnitPrice Float?` (pre-discount unit price snapshot). `unitPrice` continues to hold the **discounted** price charged.

Migration is additive/nullable → zero-downtime safe. Applied to prod out-of-band (repo gitignores `prisma/migrations/`); `schema.prisma` change drives the build-time `prisma generate`.

### 2.2 Price computation (single shared helper)

`resolveActiveDiscount(product, now)`:
- Consider product's discounts where `isActive && startDate <= now <= endDate`.
- Compute the resulting price for each: `PERCENT → price * (1 - value/100)`; `AMOUNT → max(0, price - value)`.
- **Best-price-wins:** choose the discount yielding the lowest price. Ties → any.
- Returns `{ discount, discountedPrice, discountAmount }` or `null`.
- Variants inherit the chosen discount's rule applied to each variant's own price (percent uniformly; amount subtracted per variant, floored at 0).

Used in two places: (a) product read resolvers to expose computed fields; (b) `createMerchOrder` to compute the charged price server-side.

### 2.3 GraphQL API

- Type `MerchDiscount { id name type value startDate endDate isActive products/productIds createdAt updatedAt }`.
- On `MerchProduct` type add computed: `activeDiscount: MerchDiscount`, `discountedPrice: Float`, `discountAmount: Float` (resolved at query time using `now`), plus `discounts: [MerchDiscount!]`.
- Queries: `getMerchDiscounts(tenantId/tenantSlug, isActive, limit, offset)`, `getMerchDiscountById(id)`.
- Mutations: `createMerchDiscount(input)`, `updateMerchDiscount(id, input)`, `deleteMerchDiscount(id)` (soft delete). Input: `{ name, type, value, startDate, endDate, isActive, productIds }`.
- `CreateMerchProductInput` / `UpdateMerchProductInput`: add `discountIds: [ID!]` (connect/set).
- Permissions: reuse existing `merch:read` / `merch:create` / `merch:update` / `merch:delete` (no new permission seeding).

### 2.4 Order flow (real discount)

`createMerchOrder` already recomputes totals server-side. Extend it to, per item, look up the product's active discount at order time, set `originalUnitPrice` = base price and `unitPrice` = discounted price, accumulate `discountTotal`, and compute `subtotal`/`total` from discounted prices. The client's prices are never trusted.

### 2.5 Admin UI (`mongolec-admin`)

- New **Discounts** section under merch:
  - List page (`/merch/discounts`): DataTable — name, type, value, date range, active, product count, actions.
  - Create/edit form: `name`, `type` (Select), `value`, `startDate`/`endDate` (date pickers via existing `react-day-picker`), `isActive` toggle, and a **products multi-select** (`AutocompleteSelectFilter` `isMulti`, backed by `GET_MERCH_PRODUCTS`).
- Product form (`merch-product-form.tsx`): new "Discounts" `FormSection` with `AutocompleteSelectFilter` (`isMulti`, backed by `GET_MERCH_DISCOUNTS`) writing `discountIds` into the create/update input. Multi-select allowed; typically one is chosen; best-price-wins covers overlaps.

### 2.6 Storefront (`mec-merch`)

Product cards and PDP show the sale price when `activeDiscount` is present: original price struck through + discounted price (and optionally a small "-N%"/"-Amount" badge). Uses the API's computed `discountedPrice`/`activeDiscount`. No client-side discount math.

## 3. Orders Excel Export

### 3.1 Backend (`mongolec-backend`)

- Add dependency `exceljs`.
- New mutation `exportMerchOrders(input): MerchOrderExport`, `merch:read` permission.
  - `input`: `{ orderIds: [ID!], startDate: DateTime, endDate: DateTime, tenantId }` — provide **either** `orderIds` (explicit set, for the "this page / 25" option) **or** a date range. If neither, export all (tenant-scoped).
  - Resolves the order set (`prisma.merchOrder.findMany` with `include: { items: true }`, `createdAt` filter when a range is given), builds the workbook with `exceljs`, returns `{ filename, mimeType, base64, count }`.
- Sheet layout: **one row per order** — columns: Order #, Date, Status, Customer, Phone, Email, Address, Delivery method, Payment method, Items (summarized, e.g. "2× T‑Shirt (M), 1× Mug"), Subtotal, Discount, Total, Currency.

### 3.2 Admin UI (`mongolec-admin`)

- Orders page header: an **"Export Excel"** dropdown button (in the `PageHeader` actions slot):
  - **This page (25)** → sends the `orderIds` of the rows currently shown by the TanStack table page.
  - **Last 3 days / 7 days / 3 months / 1 year** → client computes `startDate`/`endDate`.
  - **Custom range** → date-range picker (`DataTableDateRangeFilter`).
  - **All** → no filter.
- On selection: call `exportMerchOrders`, base64-decode to a `Blob`, `URL.createObjectURL`, trigger an `<a download>` with the returned filename. Add a tiny `downloadBase64File` helper.

## 4. Rollout / sequencing

Cross-repo with a prod DB migration, so phased:
1. **Backend – discounts**: schema + migration, discount CRUD API, product input `discountIds`, computed product fields, `createMerchOrder` discount logic. Ship + verify API.
2. **Admin – discounts**: Discounts list/form + product-form picker.
3. **Storefront**: mec-merch sale-price display.
4. **Backend – export**: `exceljs` + `exportMerchOrders` mutation.
5. **Admin – export**: Orders page export dropdown + download.

Each phase is its own branch/PR per repo. Deploy order matters (backend before the admin/storefront that queries new fields — same lesson as the category `image` field).

## 5. Testing

- Backend unit tests for `resolveActiveDiscount` (percent, amount, floor-at-zero, expired/inactive windows, best-price-wins ties, no discount).
- Backend integration tests: discount CRUD, product create/update with `discountIds`, `createMerchOrder` charging discounted totals + `discountTotal`, `exportMerchOrders` returns a valid non-empty workbook for orderIds / date-range / all.
- Admin: form submit shape, export dropdown calls mutation with correct args and triggers a download.
- Follow TDD (red → green → refactor); target the repo's existing coverage bar.
