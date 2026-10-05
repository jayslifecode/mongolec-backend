import Joi from 'joi';
import request from 'supertest';
import express from 'express';
import {
  validateBody,
  validateQuery,
  validateRequest,
  commonSchemas,
} from '../src/middleware/validation.middleware';
import { AppError } from '../src/types';

describe('Validation Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  // Express only forwards a thrown/`next(err)` error to an error-handling
  // (4-arg) middleware registered AFTER the layer that threw — it never
  // revisits earlier layers. Registering this in `beforeEach`, before each
  // test added its routes, meant it was dead code: errors fell through to
  // Express's default HTML error handler, so `response.body.type` was
  // always undefined even though `response.status` happened to match
  // `err.statusCode`. Call this after defining routes in each test instead.
  function addErrorHandler(): void {
    app.use((err: any, req: any, res: any, next: any) => {
      if (err instanceof AppError) {
        return res.status(err.statusCode).json({
          type: err.type,
          message: err.message,
          details: err.details,
        });
      }
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  describe('validateBody', () => {
    it('should pass with valid data', async () => {
      const schema = Joi.object({
        email: commonSchemas.email,
        password: commonSchemas.password,
      });

      let capturedReq: any;

      app.post('/test', validateBody(schema), (req, res) => {
        capturedReq = req;
        res.status(200).json({ message: 'validated' });
      });

      const response = await request(app).post('/test').send({
        email: 'TEST@EXAMPLE.COM',
        password: 'SecurePass123',
      });

      expect(response.status).toBe(200);
      expect(capturedReq.body.email).toBe('test@example.com'); // Should be lowercased
    });

    it('should fail with invalid email', async () => {
      const schema = Joi.object({
        email: commonSchemas.email,
        password: commonSchemas.password,
      });

      app.post('/test', validateBody(schema), (req, res) => {
        res.status(200).json({ message: 'validated' });
      });
      addErrorHandler();

      const response = await request(app).post('/test').send({
        email: 'invalid-email',
        password: 'SecurePass123',
      });

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
      expect(response.body.details.validationErrors).toBeDefined();
    });

    it('should fail with weak password', async () => {
      const schema = Joi.object({
        email: commonSchemas.email,
        password: commonSchemas.password,
      });

      app.post('/test', validateBody(schema), (req, res) => {
        res.status(200).json({ message: 'validated' });
      });
      addErrorHandler();

      const response = await request(app).post('/test').send({
        email: 'test@example.com',
        password: 'weak',
      });

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
    });

    it('should strip unknown fields', async () => {
      const schema = Joi.object({
        email: commonSchemas.email,
      });

      let capturedReq: any;

      app.post('/test', validateBody(schema), (req, res) => {
        capturedReq = req;
        res.status(200).json({ message: 'validated' });
      });

      const response = await request(app).post('/test').send({
        email: 'test@example.com',
        unknownField: 'should be removed',
      });

      expect(response.status).toBe(200);
      expect(capturedReq.body).toHaveProperty('email');
      expect(capturedReq.body).not.toHaveProperty('unknownField');
    });
  });

  describe('validateQuery', () => {
    it('should validate query parameters', async () => {
      const schema = Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20),
      });

      app.get('/test', validateQuery(schema), (req, res) => {
        res.status(200).json({ message: 'validated' });
      });

      const response = await request(app).get('/test?page=1&limit=10');

      expect(response.status).toBe(200);
    });

    it('should fail with invalid query parameters', async () => {
      const schema = Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(20),
      });

      app.get('/test', validateQuery(schema), (req, res) => {
        res.status(200).json({ message: 'validated' });
      });
      addErrorHandler();

      const response = await request(app).get('/test?page=invalid');

      expect(response.status).toBe(400);
      expect(response.body.type).toBe('VALIDATION_ERROR');
    });
  });

  describe('validateRequest (combined)', () => {
    it('should validate body, query, and params together', async () => {
      const schemas = {
        body: Joi.object({
          title: Joi.string().required(),
        }),
        query: Joi.object({
          lang: Joi.string().valid('en', 'mn').default('en'),
        }),
        params: Joi.object({
          id: Joi.string().required(),
        }),
      };

      app.put('/test/:id', validateRequest(schemas), (req, res) => {
        res.status(200).json({ message: 'validated' });
      });

      const response = await request(app)
        .put('/test/test-id')
        .query({ lang: 'en' })
        .send({ title: 'Test Title' });

      expect(response.status).toBe(200);
    });

    it('should fail when any validation fails', async () => {
      const schemas = {
        body: Joi.object({
          title: Joi.string().required(),
        }),
        query: Joi.object({
          lang: Joi.string().valid('en', 'mn').default('en'),
        }),
        params: Joi.object({
          id: Joi.string().required(),
        }),
      };

      app.put('/test/:id', validateRequest(schemas), (req, res) => {
        res.status(200).json({ message: 'validated' });
      });
      addErrorHandler();

      const response = await request(app)
        .put('/test/test-id')
        .query({ lang: 'invalid' })
        .send({ title: 'Test Title' });

      expect(response.status).toBe(400);
    });
  });

  describe('Common schemas', () => {
    it('should validate multi-language text', () => {
      const schema = Joi.object({
        title: commonSchemas.multiLangText,
      });

      const { error } = schema.validate({
        title: {
          en: 'English Title',
          mn: 'Монгол Гарчиг',
        },
      });

      expect(error).toBeUndefined();
    });

    it('should reject invalid multi-language text', () => {
      const schema = Joi.object({
        title: commonSchemas.multiLangText,
      });

      const { error } = schema.validate({
        title: {
          fr: 'French Title', // Invalid language code
        },
      });

      expect(error).toBeDefined();
    });

    it('should validate slug format', () => {
      const schema = Joi.object({
        slug: commonSchemas.slug,
      });

      const { error } = schema.validate({ slug: 'valid-slug-123' });
      expect(error).toBeUndefined();

      const { error: error2 } = schema.validate({ slug: 'Invalid Slug!' });
      expect(error2).toBeDefined();
    });

    it('should validate pagination parameters', () => {
      const schema = Joi.object(commonSchemas.pagination);

      const { error, value } = schema.validate({
        page: 1,
        limit: 10,
      });

      expect(error).toBeUndefined();
      expect(value.orderDirection).toBe('desc'); // Default value
    });
  });

  describe('sanitizeHTML', () => {
    it('should remove script tags', () => {
      const { sanitizeHTML } = require('../src/middleware/validation.middleware');
      const html = '<p>Safe content</p><script>alert("XSS")</script>';

      const sanitized = sanitizeHTML(html);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('<p>Safe content</p>');
    });

    it('should remove event handlers', () => {
      const { sanitizeHTML } = require('../src/middleware/validation.middleware');
      const html = '<div onclick="malicious()">Content</div>';

      const sanitized = sanitizeHTML(html);

      expect(sanitized).not.toContain('onclick');
    });

    it('should remove javascript: protocol', () => {
      const { sanitizeHTML } = require('../src/middleware/validation.middleware');
      const html = '<a href="javascript:alert(1)">Click</a>';

      const sanitized = sanitizeHTML(html);

      expect(sanitized).not.toContain('javascript:');
    });
  });
});
