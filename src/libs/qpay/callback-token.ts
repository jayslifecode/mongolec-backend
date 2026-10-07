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
