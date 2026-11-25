import { PrismaClient } from '@prisma/client';
import { config } from '@/config';
import { createLogger, logDatabaseQuery } from '@/utils/logger';
import { softDeleteOperation } from './soft-delete';

const logger = createLogger('DATABASE');

/**
 * Create extended Prisma Client with soft delete, tenant isolation, and performance monitoring
 */
function createExtendedPrismaClient() {
  const basePrisma = new PrismaClient({
    log: config.isDevelopment ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: config.database.url,
      },
    },
  });

  return basePrisma.$extends({
    query: {
      // Apply to all models and operations
      $allOperations: async ({ operation, model, args, query }) => {
        // Performance monitoring
        const start = Date.now();

        // Soft delete: models with a deletedAt column are marked deleted instead of removed.
        // Others (rider-rally links, user roles, ...) are really deleted.
        const softOperation = softDeleteOperation(operation, model);
        if (softOperation) {
          // @ts-ignore - model accessor is resolved at runtime
          return (basePrisma[model] as any)[softOperation]({
            ...args,
            data: { deletedAt: new Date() },
          });
        }

        // Tenant isolation warning for models with tenantId
        const modelsWithTenant = ['user', 'role', 'permission', 'content', 'media', 'auditLog'];
        if (modelsWithTenant.includes(model?.toLowerCase() || '')) {
          if (operation === 'findMany' || operation === 'findFirst') {
            if (args.where && !args.where.tenantId) {
              logger.warn('Query without tenant isolation detected', {
                model,
                operation,
              });
            }
          }
        }

        // Execute query
        const result = await query(args);

        // Log slow queries
        const duration = Date.now() - start;
        if (duration > 1000) {
          logger.warn('Slow query detected', {
            model,
            operation,
            duration: `${duration}ms`,
          });
        }

        return result;
      },
    },
  });
}

// Export type for the extended Prisma Client
export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

/**
 * Extended Prisma Client with logging and extensions
 * Provides connection management and query logging for better observability
 */
class DatabaseClient {
  private static instance: ExtendedPrismaClient | null = null;
  private isConnected = false;

  /**
   * Get singleton Prisma client instance
   */
  static getInstance(): ExtendedPrismaClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = createExtendedPrismaClient();
    }
    return DatabaseClient.instance;
  }

  /**
   * Connect to database with retry logic
   */
  async connect(): Promise<boolean> {
    try {
      const prisma = DatabaseClient.getInstance();
      await prisma.$connect();
      this.isConnected = true;
      logger.info('Database connection established');
      return true;
    } catch (error) {
      logger.error('Failed to connect to database', error as Error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    try {
      if (DatabaseClient.instance) {
        await DatabaseClient.instance.$disconnect();
        DatabaseClient.instance = null;
        this.isConnected = false;
        logger.info('Database disconnected');
      }
    } catch (error) {
      logger.error('Error disconnecting from database', error as Error);
    }
  }

  /**
   * Check database health
   */
  async isHealthy(): Promise<boolean> {
    try {
      const prisma = DatabaseClient.getInstance();
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Database health check failed', error as Error);
      return false;
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Execute raw query with error handling
   */
  async executeRaw(query: string, params?: any[]): Promise<any> {
    try {
      const prisma = DatabaseClient.getInstance();
      const start = Date.now();
      const result = await prisma.$queryRawUnsafe(query, ...(params || []));
      const duration = Date.now() - start;

      logDatabaseQuery(query, params, duration);
      return result;
    } catch (error) {
      logDatabaseQuery(query, params, undefined, error as Error);
      throw error;
    }
  }

  /**
   * Execute transaction with retry logic
   */
  async transaction<T>(
    fn: (
      prisma: Omit<
        PrismaClient,
        '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
      >
    ) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    const prisma = DatabaseClient.getInstance();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // @ts-ignore - Extended client works with transactions
        return await prisma.$transaction(fn, {
          timeout: config.database.connectionTimeout,
          isolationLevel: 'ReadCommitted',
        });
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Transaction attempt ${attempt} failed`, {
          error: lastError.message,
          maxRetries,
        });

        if (attempt === maxRetries) {
          logger.error('Transaction failed after all retries', lastError);
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }

    throw lastError;
  }
}

// Create and export singleton instance
const databaseClient = new DatabaseClient();

// Export the Prisma client instance
export const prisma = DatabaseClient.getInstance();

// Export database utilities
export { databaseClient };

/**
 * Database utility functions
 */
export class DatabaseUtils {
  /**
   * Check if error is a unique constraint violation
   */
  static isUniqueConstraintError(error: any): boolean {
    return error?.code === 'P2002';
  }

  /**
   * Check if error is a foreign key constraint violation
   */
  static isForeignKeyConstraintError(error: any): boolean {
    return error?.code === 'P2003';
  }

  /**
   * Check if error is a record not found error
   */
  static isRecordNotFoundError(error: any): boolean {
    return error?.code === 'P2025';
  }

  /**
   * Extract constraint field from Prisma error
   */
  static extractConstraintField(error: any): string | null {
    if (error?.meta?.target) {
      return Array.isArray(error.meta.target) ? error.meta.target[0] : error.meta.target;
    }
    return null;
  }

  /**
   * Generate tenant-scoped where clause
   */
  static tenantWhere(tenantId: string, additionalWhere?: any): any {
    return {
      tenantId,
      deletedAt: null,
      ...additionalWhere,
    };
  }

  /**
   * Generate pagination parameters
   */
  static paginationParams(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    return { skip, take: limit };
  }

  /**
   * Generate order by parameters
   */
  static orderByParams(orderBy?: string, orderDirection: 'asc' | 'desc' = 'desc') {
    if (!orderBy) return { createdAt: orderDirection };
    return { [orderBy]: orderDirection };
  }
}

export default prisma;
