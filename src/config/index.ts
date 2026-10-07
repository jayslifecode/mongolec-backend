import dotenv from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenv.config();

/**
 * Configuration schema validation using Joi
 * Ensures all required environment variables are present and valid
 */
const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(4000),
  HOST: Joi.string().default('localhost'),

  // Database configuration
  DATABASE_URL: Joi.string().required(),
  DATABASE_POOL_SIZE: Joi.number().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT: Joi.number().min(1000).default(5000),

  // Redis configuration (optional - not actively used yet)
  REDIS_URL: Joi.string().allow('').optional().default(''),
  REDIS_PASSWORD: Joi.string().allow('').optional().default(''),
  REDIS_DB: Joi.number().min(0).max(15).optional().default(0),

  // JWT configuration
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // Encryption
  ENCRYPTION_KEY: Joi.string().length(32).required(),

  // CORS configuration
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().min(60000).default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().min(10).default(100),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE_ENABLED: Joi.boolean().default(false),
  LOG_FILE_PATH: Joi.string().default('./logs'),

  // Multi-tenant
  DEFAULT_TENANT_SLUG: Joi.string().default('default'),
  TENANT_ISOLATION_LEVEL: Joi.string().valid('strict', 'moderate', 'relaxed').default('strict'),

  // File upload
  MAX_FILE_SIZE: Joi.number().min(1024).default(10485760), // 10MB
  UPLOAD_PATH: Joi.string().default('./uploads'),

  // Monitoring
  HEALTH_CHECK_ENABLED: Joi.boolean().default(true),
  METRICS_ENABLED: Joi.boolean().default(false),

  // QPay payments
  QPAY_BASE_URL: Joi.string().uri().default('https://merchant-sandbox.qpay.mn'),
  QPAY_CLIENT_ID: Joi.string().allow('').default(''),
  QPAY_CLIENT_SECRET: Joi.string().allow('').default(''),
  QPAY_INVOICE_CODE: Joi.string().allow('').default(''),
  QPAY_CALLBACK_BASE_URL: Joi.string().allow('').default(''),
  QPAY_CALLBACK_SECRET: Joi.string().allow('').default(''),
  QPAY_INVOICE_TTL_MINUTES: Joi.number().min(1).default(30),
}).unknown(true);

/**
 * Validate and extract configuration from environment variables
 */
const { error, value: envVars } = configSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

/**
 * Application configuration object
 * Type-safe configuration with validated environment variables
 */
export const config = {
  env: envVars.NODE_ENV as 'development' | 'production' | 'test',
  port: envVars.PORT as number,
  host: envVars.HOST as string,

  database: {
    url: envVars.DATABASE_URL as string,
    poolSize: envVars.DATABASE_POOL_SIZE as number,
    connectionTimeout: envVars.DATABASE_CONNECTION_TIMEOUT as number,
  },

  redis: {
    url: envVars.REDIS_URL as string,
    password: envVars.REDIS_PASSWORD as string,
    db: envVars.REDIS_DB as number,
  },

  jwt: {
    secret: envVars.JWT_SECRET as string,
    expiresIn: envVars.JWT_EXPIRES_IN as string,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN as string,
  },

  encryption: {
    key: envVars.ENCRYPTION_KEY as string,
  },

  cors: {
    origin: envVars.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
    credentials: envVars.CORS_CREDENTIALS as boolean,
  },

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS as number,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS as number,
  },

  qpay: {
    baseUrl: envVars.QPAY_BASE_URL as string,
    clientId: envVars.QPAY_CLIENT_ID as string,
    clientSecret: envVars.QPAY_CLIENT_SECRET as string,
    invoiceCode: envVars.QPAY_INVOICE_CODE as string,
    callbackBaseUrl: envVars.QPAY_CALLBACK_BASE_URL as string,
    callbackSecret: envVars.QPAY_CALLBACK_SECRET as string,
    invoiceTtlMinutes: envVars.QPAY_INVOICE_TTL_MINUTES as number,
  },

  logging: {
    level: envVars.LOG_LEVEL as string,
    fileEnabled: envVars.LOG_FILE_ENABLED as boolean,
    filePath: envVars.LOG_FILE_PATH as string,
  },

  tenant: {
    defaultSlug: envVars.DEFAULT_TENANT_SLUG as string,
    isolationLevel: envVars.TENANT_ISOLATION_LEVEL as 'strict' | 'moderate' | 'relaxed',
  },

  upload: {
    maxFileSize: envVars.MAX_FILE_SIZE as number,
    path: envVars.UPLOAD_PATH as string,
  },

  monitoring: {
    healthCheckEnabled: envVars.HEALTH_CHECK_ENABLED as boolean,
    metricsEnabled: envVars.METRICS_ENABLED as boolean,
  },

  // Computed properties
  get isProduction() {
    return this.env === 'production';
  },

  get isDevelopment() {
    return this.env === 'development';
  },

  get isTest() {
    return this.env === 'test';
  },
} as const;

export type Config = typeof config;
