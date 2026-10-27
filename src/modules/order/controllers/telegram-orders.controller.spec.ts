import { parseCallback } from './telegram-orders.controller';

const ID = '11111111-1111-1111-1111-111111111111';

describe('parseCallback', () => {
  it('parses accept / reject / next', () => {
    expect(parseCallback(`o:a:${ID}`)).toEqual({ action: { type: 'accept' }, orderId: ID });
    expect(parseCallback(`o:r:${ID}`)).toEqual({ action: { type: 'reject', reason: 'declined' }, orderId: ID });
    expect(parseCallback(`o:n:${ID}`)).toEqual({ action: { type: 'next' }, orderId: ID });
  });

  it.each([undefined, '', 'o:x:' + ID, 'o:a:short', `o:a:${ID}; DROP TABLE`, `x:a:${ID}`, `o:a:${ID}extra`])('rejects %p', (data) => {
    expect(parseCallback(data as string)).toBeNull();
  });
});
