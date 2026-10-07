import { resolvers } from '../src/graphql/resolvers';

it('discount resolvers are registered', () => {
  expect(typeof resolvers.Query.getMerchDiscounts).toBe('function');
  expect(typeof resolvers.Query.getMerchDiscountById).toBe('function');
  expect(typeof resolvers.Mutation.createMerchDiscount).toBe('function');
  expect(typeof resolvers.Mutation.updateMerchDiscount).toBe('function');
  expect(typeof resolvers.Mutation.deleteMerchDiscount).toBe('function');
});
