# QPay sandbox / go-live test

All QPay communication is backend-only. The frontend receives only the QR
text/image, deeplinks, and a status string — never credentials or raw QPay
payloads.

## Environment setup

Set in `.env` (start with sandbox; QPay's V2 API is identical on production):

```
QPAY_BASE_URL=https://merchant-sandbox.qpay.mn   # prod: https://merchant.qpay.mn
QPAY_CLIENT_ID=MONGOLEC_ORG
QPAY_CLIENT_SECRET=<secret>          # never commit; rotate the one shared in chat
QPAY_INVOICE_CODE=MONGOLEC_ORG_INVOICE
QPAY_CALLBACK_BASE_URL=<public https url>   # e.g. https://api.mongolec.org
QPAY_CALLBACK_SECRET=<random long string>
QPAY_INVOICE_TTL_MINUTES=30
```

> Note: your `INVOICE_CODE` may only exist on production. If sandbox invoice
> creation returns "invoice code not found", run the invoice/callback test
> against `https://merchant.qpay.mn` with a tiny amount instead, and cancel the
> invoice afterward.

## Test steps

1. Start backend: `npm run dev`.
2. Expose the callback publicly and set `QPAY_CALLBACK_BASE_URL` to it
   (a cloudflared/ngrok tunnel in dev, or the real domain on the server).
3. **Create order** — GraphQL `createMerchOrder(input)` → note the returned
   order `id` and `orderNumber`; `status` should be `AWAITING_PAYMENT`.
4. **Create invoice** — GraphQL `createQpayInvoice(orderId)` → confirm `qrText`,
   `qrImage`, and `deeplinks` come back. No credentials in the response.
5. **Pay** the invoice via the QPay app / sandbox flow.
6. **Callback** — confirm QPay hits `POST /api/payments/qpay/callback` (check
   logs for `QPAY_CALLBACK`). A bad/missing token must return 401.
7. **Status** — GraphQL `merchOrderPaymentStatus(orderId)` → `status` is now
   `PAID` with a `paidAt`.
8. **Expiry** — create another invoice, do NOT pay, wait past
   `QPAY_INVOICE_TTL_MINUTES`, then poll `merchOrderPaymentStatus(orderId)` →
   `status` is `EXPIRED`, inventory restored, and the QPay invoice cancelled.

## If field names differ

If the sandbox/production response uses different field casing than expected,
adjust the Joi schemas in `src/libs/qpay/qpay-client.ts` (`tokenSchema`,
`invoiceSchema`, `paymentCheckSchema`). Confirmed so far from the merchant
Postman response: token returns `token_type`, `refresh_token`, `access_token`,
`expires_in`, `refresh_expires_in`.

## Production cutover

1. Apply the migration on the server DB: run `migrations/add-qpay-payments.sql`
   against `mongolec-postgres` (additive; safe with existing data).
2. Set production env: `QPAY_BASE_URL=https://merchant.qpay.mn`, real creds,
   real `QPAY_CALLBACK_BASE_URL`, a strong `QPAY_CALLBACK_SECRET`.
3. Redeploy the backend image.
