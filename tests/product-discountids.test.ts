import { merchMutations } from '../src/graphql/resolvers/mutations/merch';

function ctx() {
  return {
    prisma: {
      merchProduct: {
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      merchVariant: { deleteMany: jest.fn(), createMany: jest.fn() },
    },
    user: { id: 'a', permissions: ['merch:create', 'merch:update'], tenantId: 'tenant-1' },
    tenant: { id: 'tenant-1' },
  } as any;
}

it('createMerchProduct connects discountIds and strips the scalar', async () => {
  const c = ctx();
  await merchMutations.createMerchProduct(
    {},
    { input: { name: { en: 'X' }, slug: 'x', price: 10, status: 'DRAFT', discountIds: ['d1'] } },
    c
  );
  const data = c.prisma.merchProduct.create.mock.calls[0][0].data;
  expect(data.discounts).toEqual({ connect: [{ id: 'd1' }] });
  expect(data.discountIds).toBeUndefined();
});
