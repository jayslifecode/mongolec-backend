describe('QPay config', () => {
  it('exposes qpay config with a sane default base url and ttl', () => {
    const { config } = require('@/config');
    expect(config.qpay).toBeDefined();
    expect(typeof config.qpay.baseUrl).toBe('string');
    expect(config.qpay.baseUrl).toMatch(/qpay\.mn/);
    expect(config.qpay.invoiceTtlMinutes).toBeGreaterThan(0);
  });
});
