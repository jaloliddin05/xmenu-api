import { PosStopListService } from './pos-stop-list.service';

describe('PosStopListService', () => {
  let row: any;
  let prisma: any;
  let provider: { fetchStopLists: jest.Mock };
  let revalidate: { addRevalidationJob: jest.Mock };
  let service: PosStopListService;

  beforeEach(() => {
    row = {
      id: 'int-1',
      organization_id: 'org-1',
      api_key_encrypted: 'enc',
      external_org_id: 'o1',
      status: 'active',
      branch_links: [
        { branch_id: 'b1', terminal_group_id: 'tg1' },
        { branch_id: 'b2', terminal_group_id: 'tg2' },
      ],
    };
    prisma = {
      pos_integration: {
        findUnique: jest.fn(async () => row),
        update: jest.fn(),
      },
      pos_menu_link: {
        findMany: jest.fn(async () => [
          {
            kind: 'product',
            external_id: 'i-plov',
            product_id: 'p-plov',
            option_id: null,
          },
          {
            kind: 'product',
            external_id: 'i-cola',
            product_id: 'p-cola',
            option_id: null,
          },
          {
            kind: 'product',
            external_id: 'i-pizza',
            product_id: 'p-pizza',
            option_id: null,
          },
          {
            kind: 'size',
            external_id: 'i-pizza:s30',
            product_id: null,
            option_id: 'o-30',
          },
          {
            kind: 'size',
            external_id: 'i-pizza:s40',
            product_id: null,
            option_id: 'o-40',
          },
        ]),
      },
      pos_stop_item: { deleteMany: jest.fn(), createMany: jest.fn() },
      $executeRaw: jest.fn(async () => 0),
      $executeRawUnsafe: jest.fn(async () => 0),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    provider = {
      fetchStopLists: jest.fn(async () => [
        {
          terminalGroupId: 'tg1',
          items: [
            { externalId: 'i-plov', sizeId: null, balance: 0 },
            { externalId: 'i-cola', sizeId: null, balance: 4 },
            { externalId: 'i-pizza', sizeId: 's30', balance: 0 },
          ],
        },
      ]),
    };
    revalidate = { addRevalidationJob: jest.fn(async () => undefined) };
    service = new PosStopListService(
      prisma,
      provider as any,
      { credentials: () => ({ integrationId: 'int-1', apiKey: 'k' }) } as any,
      revalidate as any,
    );
  });

  it('replaces the stop list of every linked branch and revalidates the menu', async () => {
    await service.refresh('int-1');
    expect(provider.fetchStopLists).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      ['tg1', 'tg2'],
    );
    expect(prisma.pos_stop_item.deleteMany.mock.calls).toEqual([
      [{ where: { branch_id: 'b1' } }],
      [{ where: { branch_id: 'b2' } }],
    ]);
    // b2 got no list: emptied; b1: the dish with nothing left and one size of the pizza
    expect(prisma.pos_stop_item.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.pos_stop_item.createMany.mock.calls[0][0].data).toEqual([
      {
        integration_id: 'int-1',
        branch_id: 'b1',
        product_id: 'p-plov',
        option_id: null,
        balance: 0,
      },
      {
        integration_id: 'int-1',
        branch_id: 'b1',
        product_id: 'p-pizza',
        option_id: 'o-30',
        balance: 0,
      },
    ]);
    // Written under the integration lock
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['pos:int-1']);
    expect(prisma.pos_integration.update).toHaveBeenCalledWith({
      where: { id: 'int-1' },
      data: { stop_list_updated_at: expect.any(Date) },
    });
    expect(revalidate.addRevalidationJob).toHaveBeenCalledWith({
      tenantId: 'org-1',
      route: 'menu',
    });
  });

  it('a draft or removed integration is left alone', async () => {
    row.status = 'draft';
    await service.refresh('int-1');
    prisma.pos_integration.findUnique.mockResolvedValue(null);
    await service.refresh('int-1');
    expect(provider.fetchStopLists).not.toHaveBeenCalled();
  });

  it('iiko failing keeps the previous stop list', async () => {
    provider.fetchStopLists.mockRejectedValue(new Error('down'));
    await expect(service.refresh('int-1')).rejects.toMatchObject({
      code: 'pos_unavailable',
    });
    expect(prisma.pos_stop_item.deleteMany).not.toHaveBeenCalled();
  });

  it('an integration disconnected while the list was fetched gets nothing written', async () => {
    prisma.pos_integration.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ status: 'disconnected' });
    await service.refresh('int-1');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.pos_stop_item.deleteMany).not.toHaveBeenCalled();
    expect(revalidate.addRevalidationJob).not.toHaveBeenCalled();
  });
});
