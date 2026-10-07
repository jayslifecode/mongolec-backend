jest.mock('@/database/redis', () => ({
  redisClient: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true) },
}));

import { redisClient } from '@/database/redis';
import { getAccessToken, createInvoice, checkPayment } from '@/libs/qpay/qpay-client';

const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

beforeEach(() => {
  fetchMock.mockReset();
  (redisClient.get as jest.Mock).mockResolvedValue(null);
  (redisClient.set as jest.Mock).mockResolvedValue(true);
});

describe('qpay-client', () => {
  it('fetches a token with Basic auth and caches it in redis', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok123', refresh_token: 'ref', expires_in: 3600 }),
    });

    const token = await getAccessToken();

    expect(token).toBe('tok123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/auth/token');
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(redisClient.set).toHaveBeenCalledWith('qpay:token', 'tok123', expect.any(Number));
  });

  it('returns the cached token without calling fetch', async () => {
    (redisClient.get as jest.Mock).mockResolvedValue('cachedTok');
    const token = await getAccessToken();
    expect(token).toBe('cachedTok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates an invoice and normalizes the response', async () => {
    (redisClient.get as jest.Mock).mockResolvedValue('cachedTok');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invoice_id: 'inv-1',
        qr_text: 'QRDATA',
        qr_image: 'base64img',
        qPay_shortUrl: 'https://s.qpay.mn/x',
        urls: [{ name: 'khan', description: 'Khan', logo: 'l', link: 'khan://pay' }],
      }),
    });

    const res = await createInvoice({
      senderInvoiceNo: 'MEC-1',
      amount: 1000,
      description: 'Order MEC-1',
      callbackUrl: 'https://x/cb',
    });

    expect(res.invoiceId).toBe('inv-1');
    expect(res.qrText).toBe('QRDATA');
    expect(res.deeplinks[0].link).toBe('khan://pay');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sender_invoice_no).toBe('MEC-1');
    expect(body.callback_url).toBe('https://x/cb');
  });

  it('checkPayment normalizes rows and paid amount', async () => {
    (redisClient.get as jest.Mock).mockResolvedValue('cachedTok');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        paid_amount: 1000,
        rows: [{ payment_id: 'p9', payment_status: 'PAID', payment_amount: '1000.00' }],
      }),
    });

    const res = await checkPayment('inv-1');
    expect(res.count).toBe(1);
    expect(res.rows[0].paymentId).toBe('p9');
    expect(res.rows[0].paymentAmount).toBe(1000);
  });
});
