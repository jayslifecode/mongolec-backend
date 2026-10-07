import { config } from '../src/config';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mongolec_test';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock Redis
//
// Must mirror the full public interface of the real `RedisClient` singleton
// (src/database/redis.ts): most middleware calls `redisClient.getClient()`
// for raw ioredis commands, but `auth.middleware.ts` and the auth resolver
// call the top-level `get`/`set`/`del` helpers directly. Omitting those
// caused `redisClient.get is not a function` at runtime.
jest.mock('../src/database/redis', () => ({
  redisClient: {
    isHealthy: () => false,
    getClient: () => ({
      set: jest.fn(),
      setex: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      pexpire: jest.fn(),
      pipeline: () => ({
        incr: jest.fn(),
        pexpire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 1]]),
      }),
    }),
    // Plain async functions rather than jest.fn() — jest.config's
    // `resetMocks: true` strips any `.mockResolvedValue(...)` set here back
    // to a bare `jest.fn()` (which resolves to `undefined`) before every
    // test, so a jest mock would break the first `await redisClient.get(...)`
    // call. These need no assertions, so plain promises are simplest.
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(false),
    del: () => Promise.resolve(false),
    delPattern: () => Promise.resolve(0),
    exists: () => Promise.resolve(false),
    expire: () => Promise.resolve(false),
    incr: () => Promise.resolve(null),
    ping: () => Promise.resolve(true),
    disconnect: () => Promise.resolve(undefined),
  },
}));

// Setup timeout
jest.setTimeout(30000);
