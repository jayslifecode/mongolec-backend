import Joi from 'joi';
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

export interface QpayPaymentRow {
  paymentId: string;
  paymentStatus: string;
  paymentAmount: number;
  fee: number;
  netAmount: number;
  wallet?: string;
  paymentType?: string;
  settlementStatus?: string;
  ebarimtCustomerNo?: string;
}

export interface QpayPaymentCheckResponse {
  count: number;
  paidAmount: number;
  rows: QpayPaymentRow[];
  raw: unknown;
}

const tokenSchema = Joi.object({
  access_token: Joi.string().required(),
  refresh_token: Joi.string().optional(),
  expires_in: Joi.number().required(),
}).unknown(true);

const invoiceSchema = Joi.object({
  invoice_id: Joi.string().required(),
  qr_text: Joi.string().required(),
  qr_image: Joi.string().required(),
  qPay_shortUrl: Joi.string().optional(),
  urls: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().allow('').default(''),
        description: Joi.string().allow('').default(''),
        logo: Joi.string().allow('').default(''),
        link: Joi.string().allow('').default(''),
      }).unknown(true)
    )
    .default([]),
}).unknown(true);

const paymentCheckSchema = Joi.object({
  count: Joi.number().required(),
  paid_amount: Joi.number().default(0),
  rows: Joi.array()
    .items(
      Joi.object({
        payment_id: Joi.string().required(),
        payment_status: Joi.string().required(),
        payment_amount: Joi.alternatives(Joi.string(), Joi.number()).optional(),
      }).unknown(true)
    )
    .default([]),
}).unknown(true);

function validate<T>(schema: Joi.Schema, data: unknown, label: string): T {
  const { error, value } = schema.validate(data, { stripUnknown: false });
  if (error) {
    logger.error(`QPay ${label} response validation failed: ${error.message}`);
    throw new Error(`Unexpected QPay ${label} response: ${error.message}`);
  }
  return value as T;
}

function baseHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function qpayFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${config.qpay.baseUrl}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error(`QPay ${path} failed: ${res.status}`);
    throw new Error(`QPay request failed (${res.status}) on ${path}: ${text.slice(0, 300)}`);
  }
  // Some endpoints (e.g. DELETE invoice) may return an empty body.
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cached = await redisClient.get(TOKEN_CACHE_KEY).catch(() => null);
    if (cached) return cached;
  }

  const basic = Buffer.from(`${config.qpay.clientId}:${config.qpay.clientSecret}`).toString(
    'base64'
  );
  const json = await qpayFetch('/v2/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
  });
  const parsed = validate<{ access_token: string; expires_in: number }>(tokenSchema, json, 'token');

  // QPay returns `expires_in` as an ABSOLUTE unix timestamp (seconds), not a
  // relative duration. Convert to remaining seconds; fall back to treating it as
  // a duration if it looks small, and clamp to a sane range so a bad value can
  // never cache a dead token for years.
  const now = Math.floor(Date.now() / 1000);
  const remaining = parsed.expires_in > 1_000_000_000 ? parsed.expires_in - now : parsed.expires_in;
  const ttl = Math.min(Math.max(remaining - TOKEN_SAFETY_BUFFER_SECONDS, 30), 3600);
  await redisClient.set(TOKEN_CACHE_KEY, parsed.access_token, ttl).catch(() => false);
  return parsed.access_token;
}

/**
 * Authenticated request to a protected QPay endpoint. If the token has expired
 * (401), drop the cached token, fetch a fresh one, and retry once — so a stale
 * cache self-heals instead of surfacing as an "Internal server error".
 */
async function authedFetch(path: string, method: string, body?: string): Promise<unknown> {
  const call = (token: string) =>
    fetch(`${config.qpay.baseUrl}${path}`, { method, headers: baseHeaders(token), body });

  let res = await call(await getAccessToken());
  if (res.status === 401) {
    logger.warn(`QPay ${path} got 401 — refreshing token and retrying`);
    await redisClient.del(TOKEN_CACHE_KEY).catch(() => 0);
    res = await call(await getAccessToken(true));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error(`QPay ${path} failed: ${res.status}`);
    throw new Error(`QPay request failed (${res.status}) on ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function createInvoice(params: CreateInvoiceParams): Promise<QpayInvoiceResponse> {
  const json = await authedFetch(
    '/v2/invoice',
    'POST',
    JSON.stringify({
      invoice_code: config.qpay.invoiceCode,
      sender_invoice_no: params.senderInvoiceNo,
      invoice_receiver_code: 'terminal',
      invoice_description: params.description,
      amount: params.amount,
      callback_url: params.callbackUrl,
    })
  );
  const parsed = validate<{
    invoice_id: string;
    qr_text: string;
    qr_image: string;
    qPay_shortUrl?: string;
    urls: Array<{ name: string; description: string; logo: string; link: string }>;
  }>(invoiceSchema, json, 'invoice');
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
  const json = await authedFetch(
    '/v2/payment/check',
    'POST',
    JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
      offset: { page_number: 1, page_limit: 100 },
    })
  );
  const parsed = validate<{
    count: number;
    paid_amount: number;
    rows: Array<{
      payment_id: string;
      payment_status: string;
      payment_amount?: string | number;
      trx_fee?: string | number;
      payment_wallet?: string;
      payment_type?: string;
      ebarimt_customer_no?: string;
      p2p_transactions?: Array<{ amount?: string | number; settlement_status?: string }>;
    }>;
  }>(paymentCheckSchema, json, 'payment/check');
  return {
    count: parsed.count,
    paidAmount: parsed.paid_amount,
    rows: parsed.rows.map(r => {
      const amount = Number(r.payment_amount ?? 0);
      const fee = Number(r.trx_fee ?? 0);
      // The merchant settlement is the largest p2p transaction (the fee is a
      // separate, smaller one); use it for the settlement status.
      const settlement = (r.p2p_transactions ?? [])
        .slice()
        .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))[0];
      return {
        paymentId: r.payment_id,
        paymentStatus: r.payment_status,
        paymentAmount: amount,
        fee,
        netAmount: Math.max(amount - fee, 0),
        wallet: r.payment_wallet,
        paymentType: r.payment_type,
        settlementStatus: settlement?.settlement_status,
        ebarimtCustomerNo: r.ebarimt_customer_no,
      };
    }),
    raw: json,
  };
}

export async function cancelInvoice(invoiceId: string): Promise<void> {
  await authedFetch(`/v2/invoice/${invoiceId}`, 'DELETE');
}
