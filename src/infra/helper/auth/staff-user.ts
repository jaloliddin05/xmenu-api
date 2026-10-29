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
  organization?: OrganizationLike | null;
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

const file = (f: FileLike | null | undefined) => (f ? { id: f.id, url: f.url } : f);

/**
 * The staff user as it leaves the API (and as req.user): an explicit list of fields, so the password
 * hash, the organization's owner_id, order_seq and int_id and file paths on disk never go out.
 * Relations are kept only when the query included them.
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
  const o = user.organization;
  if (o !== undefined) {
    out.organization = o && {
      id: o.id,
      name: o.name,
      slug: o.slug,
      type: o.type,
      is_active: o.is_active,
      ...(o.logo !== undefined && { logo: file(o.logo) }),
      ...(o.banner !== undefined && { banner: file(o.banner) }),
      ...(o.translations && {
        translations: o.translations.map((t) => ({ id: t.id, lang: t.lang, description: t.description })),
      }),
    };
  }
  return out;
}
