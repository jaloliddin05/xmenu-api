import { hiddenByStopList, stoppedProducts } from './stop-list';

describe('stoppedProducts', () => {
  const products = new Map([
    ['i-plov', 'p-plov'],
    ['i-pizza', 'p-pizza'],
    ['i-cola', 'p-cola'],
  ]);
  const sizes = new Map([['i-pizza', 2]]);

  it('stops a dish with a zero balance; a positive balance is what is left, not a stop', () => {
    expect(
      stoppedProducts(
        [
          { externalId: 'i-plov', sizeId: null, balance: 0 },
          { externalId: 'i-cola', sizeId: null, balance: 3 },
        ],
        products,
        sizes,
      ),
    ).toEqual([{ productId: 'p-plov', balance: 0 }]);
  });

  it('a dish with sizes stops only when every size is stopped', () => {
    const one = [{ externalId: 'i-pizza', sizeId: 's30', balance: 0 }];
    expect(stoppedProducts(one, products, sizes)).toEqual([]);
    expect(
      stoppedProducts(
        [...one, { externalId: 'i-pizza', sizeId: 's40', balance: 0 }],
        products,
        sizes,
      ),
    ).toEqual([{ productId: 'p-pizza', balance: 0 }]);
  });

  it('a size entry of a dish without sizes stops the dish; unknown positions are skipped', () => {
    expect(
      stoppedProducts(
        [
          { externalId: 'i-plov', sizeId: 'any', balance: 0 },
          { externalId: 'i-unknown', sizeId: null, balance: 0 },
        ],
        products,
        sizes,
      ),
    ).toEqual([{ productId: 'p-plov', balance: 0 }]);
  });
});

describe('hiddenByStopList', () => {
  const stops = [
    { product_id: 'plov', branch_id: 'b1' },
    { product_id: 'plov', branch_id: 'b2' },
    { product_id: 'cola', branch_id: 'b1' },
  ];

  it('venue-wide: only what every linked branch stopped', () => {
    expect([...hiddenByStopList(stops, ['b1', 'b2'])]).toEqual(['plov']);
  });

  it('for a branch: its own stop list', () => {
    expect([...hiddenByStopList(stops, ['b1', 'b2'], 'b1')].sort()).toEqual([
      'cola',
      'plov',
    ]);
    expect([...hiddenByStopList(stops, ['b1', 'b2'], 'b3')]).toEqual([]);
  });

  it('no linked branch: nothing is hidden', () => {
    expect([...hiddenByStopList(stops, [])]).toEqual([]);
  });
});
