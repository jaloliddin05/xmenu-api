import { hiddenByStopList, stoppedOptions, stoppedProducts } from './stop-list';

describe('stoppedProducts', () => {
  const products = new Map([
    ['i-plov', 'p-plov'],
    ['i-pizza', 'p-pizza'],
    ['i-cola', 'p-cola'],
  ]);
  const sizes = new Map([
    [
      'i-pizza',
      new Map([
        ['s30', 'o-30'],
        ['s40', 'o-40'],
      ]),
    ],
  ]);
  const whole = (productId: string) => ({
    productId,
    optionId: null,
    balance: 0,
  });

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
    ).toEqual([whole('p-plov')]);
  });

  it('one stopped size stops that size option, not the dish', () => {
    expect(
      stoppedProducts(
        [{ externalId: 'i-pizza', sizeId: 's30', balance: 0 }],
        products,
        sizes,
      ),
    ).toEqual([{ productId: 'p-pizza', optionId: 'o-30', balance: 0 }]);
  });

  it('every size stopped, or an entry without a size: the whole dish', () => {
    expect(
      stoppedProducts(
        [
          { externalId: 'i-pizza', sizeId: 's30', balance: 0 },
          { externalId: 'i-pizza', sizeId: 's40', balance: 0 },
        ],
        products,
        sizes,
      ),
    ).toEqual([whole('p-pizza')]);
    expect(
      stoppedProducts(
        [
          { externalId: 'i-pizza', sizeId: 's30', balance: 0 },
          { externalId: 'i-pizza', sizeId: null, balance: 0 },
        ],
        products,
        sizes,
      ),
    ).toEqual([whole('p-pizza')]);
  });

  it('a size entry of a dish without sizes stops the dish; unknown positions and sizes are skipped', () => {
    expect(
      stoppedProducts(
        [
          { externalId: 'i-plov', sizeId: 'any', balance: 0 },
          { externalId: 'i-unknown', sizeId: null, balance: 0 },
          { externalId: 'i-pizza', sizeId: 's99', balance: 0 },
        ],
        products,
        sizes,
      ),
    ).toEqual([whole('p-plov')]);
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

describe('stoppedOptions', () => {
  const stops = [
    { product_id: 'pizza', option_id: 'o-30', branch_id: 'b1' },
    { product_id: 'pizza', option_id: 'o-30', branch_id: 'b2' },
    { product_id: 'pizza', option_id: 'o-40', branch_id: 'b1' },
    { product_id: 'plov', option_id: null, branch_id: 'b1' },
  ];

  it('venue-wide only sizes stopped in every linked branch; per branch its own', () => {
    expect([...stoppedOptions(stops, ['b1', 'b2'])]).toEqual(['o-30']);
    expect([...stoppedOptions(stops, ['b1', 'b2'], 'b1')].sort()).toEqual([
      'o-30',
      'o-40',
    ]);
  });

  it('a stopped size does not hide the dish', () => {
    expect([...hiddenByStopList(stops, ['b1'], 'b1')]).toEqual(['plov']);
  });
});
