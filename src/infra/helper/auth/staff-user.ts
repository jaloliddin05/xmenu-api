import { permissionsOf } from 'src/modules/auth/access/permissions';
import type {
  Permission,
  StaffRole,
} from 'src/modules/auth/access/permissions';

interface FileLike {
  id: string;
  url: string;
}

interface OrganizationLike {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  is_active: boolean;
  logo?: FileLike | null;
  banner?: FileLike | null;
  translations?: { id: string; lang: string; description: string | null }[];
}

interface UserLike {
  id: string;
  phone: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  url: string | null;
  isActive: boolean;
  created_at: Date;
  avatar_id: string | null;
  avatar?: FileLike | null;
  membership?: {
    role: StaffRole;
    status: string;
    organization: OrganizationLike;
  } | null;
}

export interface StaffUser {
  id: string;
  phone: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  url: string | null;
  isActive: boolean;
  created_at: Date;
  avatar_id: string | null;
  avatar?: FileLike | null;
  /** The role in the venue (null: no venue); present when the membership was loaded. */
  role?: StaffRole | null;
  /** What the role may do (auth/access/permissions.ts); the dashboard shows screens by it. */
  permissions?: Permission[];
  organization?: {
    id: string;
    name: string;
    slug: string | null;
    type: string;
    is_active: boolean;
    logo?: FileLike | null;
    banner?: FileLike | null;
    translations?: { id: string; lang: string; description: string | null }[];
  } | null;
}

/** What toStaffUser needs from Prisma: the membership with its venue. */
export const STAFF_USER_INCLUDE = {
  membership: {
    include: {
      organization: {
        include: { logo: true, banner: true, translations: true },
      },
    },
  },
} as const;

const file = (f: FileLike | null | undefined) =>
  f ? { id: f.id, url: f.url } : f;

/**
 * The staff user as it leaves the API (and as req.user): an explicit list of fields, so the password
 * hash, the organization's order_seq and int_id and file paths on disk never go out.
 * Relations are kept only when the query included them; the organization and the role come from the membership.
 */
export function toStaffUser(user: UserLike): StaffUser {
  const out: StaffUser = {
    id: user.id,
    phone: user.phone,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    url: user.url,
    isActive: user.isActive,
    created_at: user.created_at,
    avatar_id: user.avatar_id,
  };
  if (user.avatar !== undefined) out.avatar = file(user.avatar);
  if (user.membership !== undefined) {
    // A disabled membership grants nothing (the user is switched off with it, see StaffService.disable)
    const m = user.membership?.status === 'active' ? user.membership : null;
    out.role = m?.role ?? null;
    out.permissions = permissionsOf(m?.role);
    const o = m?.organization ?? null;
    out.organization = o && {
      id: o.id,
      name: o.name,
      slug: o.slug,
      type: o.type,
      is_active: o.is_active,
      ...(o.logo !== undefined && { logo: file(o.logo) }),
      ...(o.banner !== undefined && { banner: file(o.banner) }),
      ...(o.translations && {
        translations: o.translations.map((t) => ({
          id: t.id,
          lang: t.lang,
          description: t.description,
        })),
      }),
    };
  }
  return out;
}
