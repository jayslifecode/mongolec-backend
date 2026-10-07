import { Router, Request, Response } from 'express';
import { prisma } from '@/database/prisma';
import { verifyOrderRef } from '@/libs/qpay/callback-token';
import { confirmPayment } from '@/libs/qpay/qpay-service';
import { createLogger } from '@/utils/logger';

const logger = createLogger('QPAY_CALLBACK');

async function handleCallback(req: Request, res: Response): Promise<void> {
  const orderId = String(req.query.order ?? '');
  const token = String(req.query.token ?? '');

  if (!orderId || !token || !verifyOrderRef(orderId, token)) {
    logger.warn(`Rejected QPay callback for order=${orderId} (bad token)`);
    res.status(401).json({ error: 'Invalid callback token' });
    return;
  }

  try {
    // Never trust the callback body — confirmPayment re-verifies with QPay.
    await confirmPayment(prisma as any, orderId);
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`QPay callback processing failed for order ${orderId}`, error as Error);
    // Still 200 so QPay does not spam retries; we log for manual follow-up.
    res.status(200).json({ received: true });
  }
}

export const qpayCallbackRouter = Router();
qpayCallbackRouter.post('/callback', handleCallback);
qpayCallbackRouter.get('/callback', handleCallback);
