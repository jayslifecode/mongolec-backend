import {
  requirePermission,
  requireRole,
  checkPermission,
  checkRole,
} from '../src/auth/rbac.middleware';
import { AppError } from '../src/types';

describe('RBAC Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        roles: ['ADMIN', 'EDITOR'],
        permissions: ['content:create', 'content:update', 'user:read'],
      },
    };
    mockRes = {};
    mockNext = jest.fn();
  });

  describe('requirePermission', () => {
    it('should pass when user has required permission', () => {
      const middleware = requirePermission('content:create');

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw error when user lacks permission', () => {
      const middleware = requirePermission('content:delete');

      expect(() => middleware(mockReq, mockRes, mockNext)).toThrow(AppError);
    });

    it('should throw authentication error when user is not authenticated', () => {
      mockReq.user = undefined;
      const middleware = requirePermission('content:create');

      expect(() => middleware(mockReq, mockRes, mockNext)).toThrow(AppError);
    });
  });

  describe('requireRole', () => {
    it('should pass when user has required role', () => {
      const middleware = requireRole('ADMIN');

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw error when user lacks role', () => {
      const middleware = requireRole('SUPER_ADMIN');

      expect(() => middleware(mockReq, mockRes, mockNext)).toThrow(AppError);
    });

    it('should throw authentication error when user is not authenticated', () => {
      mockReq.user = undefined;
      const middleware = requireRole('ADMIN');

      expect(() => middleware(mockReq, mockRes, mockNext)).toThrow(AppError);
    });
  });

  describe('GraphQL helpers', () => {
    describe('checkPermission', () => {
      it('should pass when context has required permission', () => {
        const context = {
          user: {
            id: 'user-123',
            permissions: ['content:create'],
          },
        };

        expect(() => checkPermission(context, 'content:create')).not.toThrow();
      });

      it('should throw error when context lacks permission', () => {
        const context = {
          user: {
            id: 'user-123',
            permissions: ['content:read'],
          },
        };

        expect(() => checkPermission(context, 'content:create')).toThrow(AppError);
      });

      it('should throw error when context has no user', () => {
        const context = {};

        expect(() => checkPermission(context, 'content:create')).toThrow(AppError);
      });
    });

    describe('checkRole', () => {
      it('should pass when context has required role', () => {
        const context = {
          user: {
            id: 'user-123',
            roles: ['ADMIN'],
          },
        };

        expect(() => checkRole(context, 'ADMIN')).not.toThrow();
      });

      it('should throw error when context lacks role', () => {
        const context = {
          user: {
            id: 'user-123',
            roles: ['EDITOR'],
          },
        };

        expect(() => checkRole(context, 'ADMIN')).toThrow(AppError);
      });
    });
  });
});
