import { GraphQLError } from 'graphql';
import { redisClient } from '@/database/redis';
import { createLogger } from '@/utils/logger';

const logger = createLogger('SUBMISSION_THROTTLE');

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SEC = 600;

export interface SubmissionThrottleOptions {
  limit?: number;
  windowSec?: number;
}

interface InMemoryEntry {
  count: number;
  resetAt: number;
}

const inMemoryStore = new Map<string, InMemoryEntry>();

function inMemoryIncrement(key: string, windowSec: number): number {
  const now = Date.now();
  const existing = inMemoryStore.get(key);

  if (existing && existing.resetAt > now) {
    const updated = { ...existing, count: existing.count + 1 };
    inMemoryStore.set(key, updated);
    return updated.count;
  }

  inMemoryStore.set(key, { count: 1, resetAt: now + windowSec * 1000 });
  return 1;
}

async function redisIncrement(fullKey: string, windowSec: number): Promise<number> {
  const redis = redisClient.getClient();
  const pipeline = redis.pipeline();
  pipeline.incr(fullKey);
  pipeline.expire(fullKey, windowSec);
  const results = await pipeline.exec();
  const count = results?.[0]?.[1] as number;
  return count;
}

/**
 * Throws a RATE_LIMITED GraphQLError when `key` (combined with the caller's
 * IP) has exceeded `limit` submissions within `windowSec` seconds. Backed by
 * Redis INCR+EXPIRE, falling back to an in-memory Map when Redis is down.
 */
export async function assertSubmissionAllowed(
  key: string,
  ip: string,
  { limit = DEFAULT_LIMIT, windowSec = DEFAULT_WINDOW_SEC }: SubmissionThrottleOptions = {}
): Promise<void> {
  const fullKey = `submission-throttle:${key}:${ip}`;
  let count: number;

  if (redisClient.isHealthy()) {
    try {
      count = await redisIncrement(fullKey, windowSec);
    } catch (error) {
      logger.error(
        'Redis throttle error, falling back to memory',
        error instanceof Error ? error : undefined
      );
      count = inMemoryIncrement(fullKey, windowSec);
    }
  } else {
    count = inMemoryIncrement(fullKey, windowSec);
  }

  if (count > limit) {
    throw new GraphQLError('Too many submissions, please try again later.', {
      extensions: { code: 'RATE_LIMITED' },
    });
  }
}
