import {
  COURIER_INVITE_TTL_MS,
  hashInviteToken,
  inviteLink,
  inviteTokenFromStart,
  inviteUsable,
  newInviteToken,
} from './courier-invitation';
import { courierState } from './courier-state';

describe('courier invitation token', () => {
  it('fits the Telegram start parameter and is stored as a hash only', () => {
    const { token, hash } = newInviteToken();
    const link = inviteLink('venue_bot', token);
    const payload = link.split('?start=')[1];
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(inviteTokenFromStart(payload)).toBe(token);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
  });

  it.each([
    undefined,
    '',
    'abc',
    'c_short',
    'c_' + 'a'.repeat(44),
    'sess_' + 'a'.repeat(43),
  ])('is not a courier invitation: %p', (payload) =>
    expect(inviteTokenFromStart(payload)).toBeNull(),
  );

  it('works once, until it expires or is revoked', () => {
    const now = new Date();
    const fresh = {
      used_at: null,
      revoked_at: null,
      expires_at: new Date(now.getTime() + COURIER_INVITE_TTL_MS),
    };
    expect(COURIER_INVITE_TTL_MS).toBe(24 * 3600 * 1000);
    expect(inviteUsable(fresh, now)).toBe(true);
    expect(inviteUsable({ ...fresh, used_at: now }, now)).toBe(false);
    expect(inviteUsable({ ...fresh, revoked_at: now }, now)).toBe(false);
    expect(inviteUsable({ ...fresh, expires_at: now }, now)).toBe(false);
  });
});

describe('courier state', () => {
  it('not on shift, free, busy with N orders', () => {
    expect(courierState(false, 0)).toEqual({
      state: 'off_shift',
      activeOrders: 0,
    });
    expect(courierState(true, 0)).toEqual({ state: 'free', activeOrders: 0 });
    expect(courierState(true, 2)).toEqual({ state: 'busy', activeOrders: 2 });
  });
});
