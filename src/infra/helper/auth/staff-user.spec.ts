import { toStaffUser } from './staff-user';

const user = {
  id: 'u-1',
  phone: '+998901234567',
  password: '$2b$10$hash',
  email: null,
  first_name: 'Ali',
  last_name: null,
  url: null,
  isActive: true,
  created_at: new Date('2026-10-29T00:00:00Z'),
  avatar_id: null,
  organization: {
    id: 'org-1',
    int_id: 7,
    name: 'Mant',
    slug: 'mant',
    type: 'restaurant',
    is_active: true,
    url: null,
    created_at: new Date(),
    order_seq: 1042,
    owner_id: 'u-1',
    logo_id: 'f-1',
    banner_id: null,
    logo: {
      id: 'f-1',
      url: 'https://files/x.png',
      path: '/srv/uploads/x.png',
      product_id: null,
    },
    banner: null,
    translations: [
      {
        id: 'tr-1',
        lang: 'ru',
        description: 'Манты',
        organization_id: 'org-1',
        created_at: new Date(),
      },
    ],
  },
};

describe('toStaffUser', () => {
  it('keeps the listed fields and drops the password and internal organization columns', () => {
    expect(toStaffUser(user)).toEqual({
      id: 'u-1',
      phone: '+998901234567',
      email: null,
      first_name: 'Ali',
      last_name: null,
      url: null,
      isActive: true,
      created_at: user.created_at,
      avatar_id: null,
      organization: {
        id: 'org-1',
        name: 'Mant',
        slug: 'mant',
        type: 'restaurant',
        is_active: true,
        logo: { id: 'f-1', url: 'https://files/x.png' },
        banner: null,
        translations: [{ id: 'tr-1', lang: 'ru', description: 'Манты' }],
      },
    });
  });

  it('adds relations only when they were loaded', () => {
    const plain = { ...user, organization: undefined };
    expect(Object.keys(toStaffUser(plain))).not.toContain('organization');
    expect(
      toStaffUser({ ...plain, organization: null }).organization,
    ).toBeNull();
  });
});
