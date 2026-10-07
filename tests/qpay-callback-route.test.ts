jest.mock('@/libs/qpay/qpay-service', () => ({
  confirmPayment: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/libs/qpay/callback-token', () => ({ verifyOrderRef: jest.fn() }));
jest.mock('@/database/prisma', () => ({ prisma: {} }));
jest.mock('@/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import express from 'express';
import request from 'supertest';
import { qpayCallbackRouter } from '@/routes/qpay-callback';
import { verifyOrderRef } from '@/libs/qpay/callback-token';
import { confirmPayment } from '@/libs/qpay/qpay-service';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/payments/qpay', qpayCallbackRouter);
  return a;
}

describe('qpay callback route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a request with an invalid token', async () => {
    (verifyOrderRef as jest.Mock).mockReturnValue(false);
    const res = await request(app()).post('/api/payments/qpay/callback?order=o1&token=bad');
    expect(res.status).toBe(401);
    expect(confirmPayment).not.toHaveBeenCalled();
  });

  it('confirms payment on a valid token and returns 200', async () => {
    (verifyOrderRef as jest.Mock).mockReturnValue(true);
    const res = await request(app()).post('/api/payments/qpay/callback?order=o1&token=good');
    expect(res.status).toBe(200);
    expect(confirmPayment).toHaveBeenCalledWith(expect.anything(), 'o1');
  });
});
