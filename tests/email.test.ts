describe('sendEmail', () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.RESEND_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.resetModules();
  });

  it('returns sent:false without calling fetch when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const { sendEmail } = await import('../src/libs/email');
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(result).toEqual({ sent: false, reason: 'RESEND_API_KEY not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the Resend API with a bearer token when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'email-123' }),
    });
    global.fetch = fetchMock as any;

    const { sendEmail } = await import('../src/libs/email');
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
    expect(result).toEqual({ sent: true, id: 'email-123' });
  });

  it('never throws when the Resend API call fails', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock as any;

    const { sendEmail } = await import('../src/libs/email');
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('network down');
  });
});
