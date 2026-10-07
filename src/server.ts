import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import depthLimit from 'graphql-depth-limit';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config } from '@/config';
import { typeDefs } from '@/graphql/schema';
import { resolvers } from '@/graphql/resolvers';
import { qpayCallbackRouter } from '@/routes/qpay-callback';
import { GraphQLContext } from '@/types';
import { prisma, databaseClient } from '@/database/prisma';
import { redisClient } from '@/database/redis';
import { createLogger, logRequest } from '@/utils/logger';
import { AppError, ErrorType } from '@/types';
import { authenticate, optionalAuthenticate } from '@/auth';
import { csrfProtection, graphqlRateLimit, authRateLimit, sanitizeBody } from '@/middleware';

const logger = createLogger('SERVER');

/**
 * Apollo Server with Express integration
 * Provides GraphQL API with multi-tenant support, authentication, and comprehensive middleware
 */
export class GraphQLServer {
  private app: express.Application;
  private httpServer: http.Server;
  private apolloServer: ApolloServer<GraphQLContext>;
  private requestCounter: number = 0;

  constructor() {
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.apolloServer = this.createApolloServer();
  }

  /**
   * Create and configure Apollo Server instance
   */
  private createApolloServer(): ApolloServer<GraphQLContext> {
    return new ApolloServer<GraphQLContext>({
      typeDefs,
      resolvers,
      plugins: [
        // Proper shutdown for the HTTP server
        ApolloServerPluginDrainHttpServer({ httpServer: this.httpServer }),

        // Sandbox only in development — disabled in production to reduce attack surface
        config.isDevelopment
          ? ApolloServerPluginLandingPageLocalDefault({ embed: true, includeCookies: true })
          : ApolloServerPluginLandingPageDisabled(),

        // Custom plugins for logging and monitoring
        {
          async requestDidStart() {
            return {
              async willSendResponse(requestContext: any) {
                const { request, response } = requestContext;
                logger.debug('GraphQL operation completed', {
                  operationName: request.operationName,
                  variables: config.isDevelopment ? request.variables : undefined,
                  errors:
                    response.body.kind === 'single' && response.body.singleResult.errors?.length,
                });
              },
              async didEncounterErrors(requestContext: any) {
                const { request, errors } = requestContext;
                logger.error('GraphQL operation errors', new Error('GraphQL Errors'), {
                  operationName: request.operationName,
                  errors: errors.map((error: any) => ({
                    message: error.message,
                    path: error.path,
                    locations: error.locations,
                  })),
                });
              },
            };
          },
        },
      ],

      // Error formatting
      formatError: (formattedError, error) => {
        // Log error details
        logger.error('GraphQL error occurred', error as Error, {
          formattedError,
          path: formattedError.path,
          locations: formattedError.locations,
        });

        // Get the original error (Apollo wraps custom errors in GraphQLError)
        const originalError = (error as any).originalError;

        // Don't expose internal errors in production
        if (config.isProduction && !(originalError instanceof AppError)) {
          return {
            message: 'Internal server error',
            code: 'INTERNAL_ERROR',
            path: formattedError.path,
            locations: formattedError.locations,
          };
        }

        // For AppError instances, return the proper error type
        if (originalError instanceof AppError) {
          return {
            message: formattedError.message,
            code: originalError.type,
            path: formattedError.path,
            locations: formattedError.locations,
            ...(config.isDevelopment && { stack: (error as Error)?.stack }),
          };
        }

        return {
          message: formattedError.message,
          code: (error as any)?.code || 'UNKNOWN_ERROR',
          path: formattedError.path,
          locations: formattedError.locations,
          ...(config.isDevelopment && { stack: (error as Error)?.stack }),
        };
      },

      // Introspection enabled for GraphQL clients (Postman, Insomnia, etc.)
      introspection: config.isDevelopment,
      validationRules: [depthLimit(7)],
    });
  }

  /**
   * Set up Express middleware stack
   */
  private setupMiddleware(): void {
    // Trust nginx reverse proxy so req.ip returns the real client IP from X-Forwarded-For
    this.app.set('trust proxy', 1);

    // Security middleware with relaxed CSP for Apollo Sandbox
    this.app.use(
      helmet({
        contentSecurityPolicy: false, // Disable CSP to allow Apollo Sandbox to work
        crossOriginEmbedderPolicy: false,
      })
    );

    // CORS configuration — allow any *.mongolec.org subdomain plus explicit env origins
    const explicitOrigins = new Set(config.cors.origin);
    this.app.use(
      cors({
        origin: (origin, callback) => {
          // Allow non-browser requests (curl, Postman, server-to-server)
          if (!origin) return callback(null, true);
          // Allow any mongolec.org subdomain
          if (origin.endsWith('.mongolec.org') || origin === 'https://mongolec.org') {
            return callback(null, true);
          }
          // Allow explicit origins from CORS_ORIGIN env var (covers localhost etc.)
          if (explicitOrigins.has(origin)) return callback(null, true);
          callback(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
      })
    );

    // Request logging
    this.app.use(
      morgan('combined', {
        stream: {
          write: (message: string) => {
            logger.info('HTTP Request', { message: message.trim() });
          },
        },
      })
    );

    // Cookie parsing
    this.app.use(cookieParser());

    // Authentication middleware (validates JWT token)
    this.app.use(authenticate);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Sanitize request body to prevent XSS attacks
    this.app.use(sanitizeBody);

    // QPay payment callback (public; secured by HMAC token in the URL +
    // re-verification against QPay inside confirmPayment).
    this.app.use('/api/payments/qpay', qpayCallbackRouter);

    // Custom request logging with response time
    this.app.use((req, res, next) => {
      const start = Date.now();

      // Increment request counter for metrics
      this.requestCounter++;

      res.on('finish', () => {
        const responseTime = Date.now() - start;
        logRequest(req, res, responseTime);

        // Track API calls for tenant (optional feature for analytics)
        // Note: This requires a tenant tracking service to be implemented
        // if ((req as any).tenant?.id) {
        //   TenantMiddleware.trackApiCall((req as any).tenant.id).catch(error => {
        //     logger.error('Failed to track API call', error);
        //   });
        // }
      });

      next();
    });

    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const dbHealthy = await databaseClient.isHealthy();
        const redisHealthy = await redisClient.ping();

        const status = dbHealthy && redisHealthy ? 'healthy' : 'degraded';
        const statusCode = status === 'healthy' ? 200 : 503;

        res.status(statusCode).json({
          status,
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealthy ? 'up' : 'down',
            redis: redisHealthy ? 'up' : 'down',
          },
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
        });
      } catch (error) {
        logger.error('Health check failed', error as Error);
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed',
        });
      }
    });

    // Metrics endpoint (if enabled)
    if (config.monitoring.metricsEnabled) {
      this.app.get(
        '/metrics',
        (req, res, next) => {
          const token = req.headers['authorization']?.replace('Bearer ', '');
          if (!process.env.METRICS_SECRET || token !== process.env.METRICS_SECRET) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          next();
        },
        (req, res) => {
          // Basic metrics (can be extended with Prometheus format)
          const uptime = process.uptime();
          const memoryUsage = process.memoryUsage();

          const metrics = `# Mongolec Backend Metrics
# HELP system_uptime_seconds System uptime in seconds
# TYPE system_uptime_seconds gauge
system_uptime_seconds ${uptime}

# HELP nodejs_memory_usage_bytes Node.js memory usage
# TYPE nodejs_memory_usage_bytes gauge
nodejs_memory_usage_bytes{type="rss"} ${memoryUsage.rss}
nodejs_memory_usage_bytes{type="heap_total"} ${memoryUsage.heapTotal}
nodejs_memory_usage_bytes{type="heap_used"} ${memoryUsage.heapUsed}
nodejs_memory_usage_bytes{type="external"} ${memoryUsage.external}

# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total ${this.requestCounter}

# HELP graphql_operations_total Total GraphQL operations
# TYPE graphql_operations_total counter
graphql_operations_total 0
`;

          res.set('Content-Type', 'text/plain');
          res.send(metrics);
        }
      );
    }

    // CSRF protection is disabled: JWT auth in httpOnly cookies + strict CORS
    // provides sufficient protection for this API. Re-enable csrfProtection
    // here once the frontend sends the x-csrf-token header on every mutation.
    logger.info('CSRF protection disabled (JWT + CORS in use)');

    // Apply rate limiting to GraphQL endpoint
    this.app.use('/graphql', graphqlRateLimit);

    // Stricter rate limit for auth mutations (login, register, forgotPassword)
    this.app.use('/graphql', (req, res, next) => {
      const body = req.body as { operationName?: string; query?: string };
      const operation = body?.operationName?.toLowerCase() ?? '';
      const query = body?.query ?? '';
      const isAuthOp =
        operation === 'login' ||
        operation === 'register' ||
        operation === 'forgotpassword' ||
        /mutation\s*\{?\s*(login|register|forgotPassword)/i.test(query);
      if (isAuthOp) {
        return authRateLimit(req, res, next);
      }
      next();
    });

    // GraphQL endpoint with context creation (Apollo's default landing page auto-serves)
    this.app.use(
      '/graphql',
      expressMiddleware(this.apolloServer, {
        context: async ({ req, res }): Promise<GraphQLContext> => {
          const user = (req as any).user || null;
          let tenant = (req as any).tenant || null;

          // For unauthenticated requests, resolve tenant from X-Tenant-ID header
          if (!tenant) {
            const headerValue = req.headers['x-tenant-id'] as string | undefined;
            if (headerValue) {
              const cacheKey = `tenant:slug:${headerValue}`;
              const cached = redisClient.isHealthy()
                ? await redisClient.getClient().get(cacheKey)
                : null;
              if (cached) {
                tenant = JSON.parse(cached);
              } else {
                tenant = await prisma.tenant.findFirst({
                  where: {
                    OR: [{ slug: headerValue }, { id: headerValue }],
                    status: 'ACTIVE',
                    deletedAt: null,
                  },
                  select: { id: true, slug: true, name: true, status: true, plan: true },
                });
                if (tenant && redisClient.isHealthy()) {
                  redisClient
                    .getClient()
                    .set(cacheKey, JSON.stringify(tenant), 'EX', 300)
                    .catch(() => {});
                }
              }
            }
          }

          return {
            req,
            res,
            prisma,
            redis: redisClient.isHealthy() ? redisClient.getClient() : (null as any),
            user,
            tenant,
            dataSources: {
              userService: null,
              tenantService: null,
              contentService: null,
            },
          };
        },
      })
    );

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found',
        path: req.originalUrl,
      });
    });

    // Global error handler
    this.app.use(
      (error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        logger.error('Unhandled error in Express', error);

        if (res.headersSent) {
          return next(error);
        }

        let statusCode = 500;
        let errorResponse = {
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
          ...(config.isDevelopment && { stack: error.stack }),
        };

        if (error instanceof AppError) {
          statusCode = error.statusCode;
          errorResponse = {
            error: error.type,
            message: error.message,
            ...(error.details && { details: error.details }),
            ...(config.isDevelopment && { stack: error.stack }),
          };
        }

        res.status(statusCode).json(errorResponse);
      }
    );
  }

  /**
   * Initialize server connections and start listening
   */
  async start(): Promise<void> {
    try {
      // Validate JWT_SECRET before starting server
      if (
        !process.env.JWT_SECRET ||
        process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-this'
      ) {
        throw new Error(
          'JWT_SECRET is not set or is still the default insecure value. Run: openssl rand -hex 64'
        );
      }

      logger.info('Starting GraphQL server...');

      // Connect to database
      const dbConnected = await databaseClient.connect();
      if (!dbConnected) {
        throw new Error('Failed to connect to database');
      }

      // Verify Redis connection
      const redisHealthy = await redisClient.ping();
      if (!redisHealthy) {
        logger.warn('Redis connection failed - caching will be disabled');
      }

      // Start Apollo Server
      await this.apolloServer.start();
      logger.info('Apollo Server started successfully');

      // Set up Express middleware
      this.setupMiddleware();

      // Start HTTP server
      await new Promise<void>(resolve => {
        this.httpServer.listen(config.port, config.host, () => {
          resolve();
        });
      });

      logger.info(`🚀 GraphQL Server ready at http://${config.host}:${config.port}/graphql`);
      logger.info(`📊 Health check available at http://${config.host}:${config.port}/health`);

      if (config.monitoring.metricsEnabled) {
        logger.info(`📈 Metrics available at http://${config.host}:${config.port}/metrics`);
      }
    } catch (error) {
      logger.error('Failed to start server', error as Error);
      throw error;
    }
  }

  /**
   * Gracefully shutdown the server
   */
  async stop(): Promise<void> {
    try {
      logger.info('Shutting down GraphQL server...');

      // Stop Apollo Server
      await this.apolloServer.stop();
      logger.info('Apollo Server stopped');

      // Close HTTP server
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close(error => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      logger.info('HTTP server stopped');

      // Disconnect from database
      await databaseClient.disconnect();
      logger.info('Database disconnected');

      // Disconnect from Redis
      await redisClient.disconnect();
      logger.info('Redis disconnected');

      logger.info('GraphQL server shutdown complete');
    } catch (error) {
      logger.error('Error during server shutdown', error as Error);
      throw error;
    }
  }

  /**
   * Get Express app instance (for testing)
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Get HTTP server instance
   */
  getHttpServer(): http.Server {
    return this.httpServer;
  }

  /**
   * Get Apollo Server instance
   */
  getApolloServer(): ApolloServer<GraphQLContext> {
    return this.apolloServer;
  }
}

export default GraphQLServer;
