import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorType } from '@/types';
import { createLogger } from '@/utils/logger';
import { redisClient } from '@/database/redis';

const logger = createLogger('RATE_LIMIT');

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string; // Redis key prefix
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

/**
 * Rate limit store interface
 */
interface RateLimitStore {
  increment(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

/**
 * Redis-based rate limit store
 */
class RedisRateLimitStore implements RateLimitStore {
  constructor(private config: RateLimitConfig) {}

  async increment(key: string): Promise<number> {
    if (!redisClient.isHealthy()) {
      // If Redis is down, use in-memory fallback (not ideal but prevents failures)
      logger.warn('Redis unavailable, using in-memory rate limiting');
      return this.inMemoryIncrement(key);
    }

    const redis = redisClient.getClient();
    const fullKey = `${this.config.keyPrefix || 'ratelimit'}:${key}`;

    try {
      // Use Redis pipeline for atomic increment and expiry
      const pipeline = redis.pipeline();
      pipeline.incr(fullKey);
      pipeline.pexpire(fullKey, this.config.windowMs);

      const results = await pipeline.exec();
      const count = results?.[0]?.[1] as number;

      return count;
    } catch (error) {
      logger.error('Redis rate limit error, falling back to memory', error as Error);
      return this.inMemoryIncrement(key);
    }
  }

  async reset(key: string): Promise<void> {
    if (!redisClient.isHealthy()) {
      this.inMemoryReset(key);
      return;
    }

    const redis = redisClient.getClient();
    const fullKey = `${this.config.keyPrefix || 'ratelimit'}:${key}`;

    try {
      await redis.del(fullKey);
    } catch (error) {
      logger.error('Redis reset error', error as Error);
    }
  }

  // Simple in-memory fallback (not production-ready for distributed systems)
  private inMemoryMap = new Map<string, { count: number; resetTime: number }>();

  private inMemoryIncrement(key: string): number {
    const now = Date.now();
    const existing = this.inMemoryMap.get(key);

    if (existing && existing.resetTime > now) {
      existing.count += 1;
      this.inMemoryMap.set(key, existing);
      return existing.count;
    }

    // Reset window
    this.inMemoryMap.set(key, {
      count: 1,
      resetTime: now + this.config.windowMs,
    });
    return 1;
  }

  private inMemoryReset(key: string): void {
    this.inMemoryMap.delete(key);
  }
}

/**
 * Create rate limit middleware
 */
export const rateLimit = (config: RateLimitConfig) => {
  const store = new RedisRateLimitStore(config);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Generate rate limit key based on IP and/or user ID
      const identifier = req.user?.id || req.ip;
      const key = `${identifier}:${req.path}`;

      // Increment counter
      const count = await store.increment(key);

      // Calculate remaining requests and reset time
      const remaining = Math.max(0, config.maxRequests - count);
      const resetTime = new Date(Date.now() + config.windowMs);

      // Add rate limit headers to response
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime.toISOString());

      // Check if limit exceeded
      if (count > config.maxRequests) {
        logger.warn('Rate limit exceeded', {
          identifier,
          path: req.path,
          count,
          limit: config.maxRequests,
        });

        throw new AppError(
          `Rate limit exceeded. Try again in ${Math.ceil(config.windowMs / 1000)} seconds.`,
          ErrorType.RATE_LIMIT_ERROR,
          429,
          true,
          {
            retryAfter: Math.ceil(config.windowMs / 1000),
            limit: config.maxRequests,
            remaining: 0,
          }
        );
      }

      // Log rate limit info in development
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Rate limit check', {
          identifier,
          path: req.path,
          count,
          limit: config.maxRequests,
          remaining,
        });
      }

      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }

      logger.error('Rate limit middleware error', error as Error);
      // On error, allow request to proceed (fail open)
      next();
    }
  };
};

/**
 * Pre-configured rate limiters for different use cases
 */

// Strict rate limiter for authentication endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  keyPrefix: 'auth',
});

// Standard API rate limiter
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  keyPrefix: 'api',
});

// Generous rate limiter for read operations
export const readRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 200,
  keyPrefix: 'read',
});

// Strict rate limiter for write operations
export const writeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 50,
  keyPrefix: 'write',
});

// GraphQL-specific rate limiter.
// Public sites (and Vercel's server-side fetches, which share a small IP pool)
// issue many queries per page view, so the ceiling is configurable and high.
const GRAPHQL_RATE_LIMIT_MAX_DEFAULT = 2000;
const GRAPHQL_RATE_LIMIT_WINDOW_MS_DEFAULT = 15 * 60 * 1000;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const graphqlRateLimit = rateLimit({
  windowMs: parsePositiveInt(process.env.GRAPHQL_RATE_LIMIT_WINDOW_MS, GRAPHQL_RATE_LIMIT_WINDOW_MS_DEFAULT),
  maxRequests: parsePositiveInt(process.env.GRAPHQL_RATE_LIMIT_MAX, GRAPHQL_RATE_LIMIT_MAX_DEFAULT),
  keyPrefix: 'graphql',
});

/**
 * Create custom rate limiter with dynamic limits based on user plan
 */
export const createTieredRateLimit = (
  getTier: (user: any) => 'free' | 'basic' | 'pro' | 'enterprise'
) => {
  const tierLimits = {
    free: { windowMs: 15 * 60 * 1000, maxRequests: 50 },
    basic: { windowMs: 15 * 60 * 1000, maxRequests: 100 },
    pro: { windowMs: 15 * 60 * 1000, maxRequests: 200 },
    enterprise: { windowMs: 15 * 60 * 1000, maxRequests: 500 },
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tier = req.user ? getTier(req.user) : 'free';
    const config = tierLimits[tier];

    const limiter = rateLimit({
      ...config,
      keyPrefix: `tiered:${tier}`,
    });

    return limiter(req, res, next);
  };
};

/**
 * Reset rate limit for a specific user (admin function)
 */
export const resetUserRateLimit = async (userId: string): Promise<void> => {
  const store = new RedisRateLimitStore({
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'ratelimit',
  });

  await store.reset(userId);
  logger.info(`Rate limit reset for user ${userId}`);
};
