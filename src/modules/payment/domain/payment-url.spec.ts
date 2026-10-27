import { buildClickUrl, buildPaymeUrl, resolveReturnUrl } from './payment-url';

const order = { id: 'ord-1', total: 113000 };

describe('payment urls', () => {
  it('Click: amount with 2 decimals, order id as transaction_param', () => {
    const url = new URL(buildClickUrl({ merchantId: 'm1', serviceId: 's1', merchantUserId: 'u', secretKey: 'k' }, order, 'https://app/order/ord-1'));
    expect(url.origin + url.pathname).toBe('https://my.click.uz/services/pay');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service_id: 's1', merchant_id: 'm1', amount: '113000.00', transaction_param: 'ord-1', return_url: 'https://app/order/ord-1',
    });
  });

  it('Click never leaks the secret key into the URL', () => {
    expect(buildClickUrl({ merchantId: 'm1', serviceId: 's1', merchantUserId: 'u', secretKey: 'TOPSECRET' }, order)).not.toContain('TOPSECRET');
  });

  it('Payme: base64 of ;-separated params, amount in tiyin', () => {
    const url = buildPaymeUrl({ merchantId: 'pm', key: 'KEY' }, order, 'https://app/order/ord-1', 'uz');
    expect(url.startsWith('https://checkout.paycom.uz/')).toBe(true);
    const decoded = Buffer.from(url.split('/').pop()!, 'base64').toString();
    expect(decoded).toBe('m=pm;ac.order_id=ord-1;a=11300000;cr=860;l=uz;c=https://app/order/ord-1');
    expect(url).not.toContain('KEY');
  });

  it('resolveReturnUrl', () => {
    expect(resolveReturnUrl('a b', { MINIAPP_URL: 'https://app.example.com/' } as any)).toBe('https://app.example.com/order/a%20b');
    expect(resolveReturnUrl('x', { MINIAPP_RETURN_URL: 'https://t.me/bot/app?startapp=order_{orderId}' } as any)).toBe('https://t.me/bot/app?startapp=order_x');
    expect(resolveReturnUrl('x', {} as any)).toBeUndefined();
  });
});
