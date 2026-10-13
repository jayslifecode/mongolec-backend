import { syncProductVariants } from '../src/graphql/resolvers/mutations/merch-variants';

type VariantRow = {
  id: string;
  sku: string;
  productId: string;
  inventory: number;
  price: number;
  deletedAt: Date | null;
};

function buildTx(rows: VariantRow[]) {
  const merchVariant = {
    findMany: jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(rows.filter(r => r.productId === where.productId))
    ),
    update: jest.fn().mockImplementation(({ where, data }: any) =>
      Promise.resolve({ ...rows.find(r => r.id === where.id), ...data })
    ),
    create: jest.fn().mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `new-${data.sku}`, deletedAt: null, ...data })
    ),
  };
  return { merchVariant } as any;
}

const live = (sku: string, inventory = 0): VariantRow => ({
  id: `id-${sku}`,
  sku,
  productId: 'prod-1',
  inventory,
  price: 100,
  deletedAt: null,
});

describe('syncProductVariants', () => {
  it('updates an existing variant in place when the SKU matches (keeps its id)', async () => {
    const tx = buildTx([live('121-S', 0)]);

    await syncProductVariants(tx, 'prod-1', [
      { sku: '121-S', price: 100, optionValues: [], inventory: 2 },
    ]);

    expect(tx.merchVariant.create).not.toHaveBeenCalled();
    expect(tx.merchVariant.update).toHaveBeenCalledTimes(1);
    expect(tx.merchVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'id-121-S' },
        data: expect.objectContaining({ inventory: 2, deletedAt: null }),
      })
    );
  });

  it('creates variants with new SKUs and soft-deletes variants no longer sent', async () => {
    const tx = buildTx([live('121-S'), live('121-M')]);

    await syncProductVariants(tx, 'prod-1', [
      { sku: '121-S', price: 100, optionValues: [], inventory: 1 },
      { sku: '121-L', price: 120, optionValues: [], inventory: 3 },
    ]);

    expect(tx.merchVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sku: '121-L', productId: 'prod-1', inventory: 3, position: 1 }),
      })
    );
    expect(tx.merchVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'id-121-M' },
        data: { deletedAt: expect.any(Date) },
      })
    );
  });

  it('revives a soft-deleted variant with the same SKU instead of violating the unique constraint', async () => {
    const tx = buildTx([{ ...live('121-S'), deletedAt: new Date('2026-01-01') }]);

    await syncProductVariants(tx, 'prod-1', [
      { sku: '121-S', price: 100, optionValues: [], inventory: 5 },
    ]);

    expect(tx.merchVariant.create).not.toHaveBeenCalled();
    expect(tx.merchVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'id-121-S' },
        data: expect.objectContaining({ inventory: 5, deletedAt: null }),
      })
    );
  });

  it('soft-deletes every live variant when an empty list is sent', async () => {
    const tx = buildTx([live('121-S')]);

    await syncProductVariants(tx, 'prod-1', []);

    expect(tx.merchVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'id-121-S' }, data: { deletedAt: expect.any(Date) } })
    );
  });

  it('rejects duplicate SKUs within one request', async () => {
    const tx = buildTx([]);

    await expect(
      syncProductVariants(tx, 'prod-1', [
        { sku: 'DUP', price: 1, optionValues: [] },
        { sku: 'DUP', price: 2, optionValues: [] },
      ])
    ).rejects.toThrow(/duplicate/i);
    expect(tx.merchVariant.create).not.toHaveBeenCalled();
  });
});
