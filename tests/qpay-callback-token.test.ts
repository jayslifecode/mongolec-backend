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
