/**
 * Mijoz manzili kiritishini tozalash va tekshirish. Nest'ga bog'liq emas —
 * oddiy funksiya, shuning uchun alohida test qilinadi (address-validators.spec.ts).
 *
 * DTO (class-validator) faqat TURNI tekshiradi (string/number/boolean).
 * Mazmun (uzunlik, belgilar, koordinata juftligi) shu yerda: bir joyda,
 * natijasi aniq — `ok: false` bo'lsa nima uchun rad etilgani ma'lum.
 */

export const ADDRESS_LIMITS = {
  title: 50,
  addressMin: 3,
  address: 200,
  shortField: 20, // entrance / floor / apartment
  comment: 250,
} as const;

export interface AddressInput {
  title?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  entrance?: unknown;
  floor?: unknown;
  apartment?: unknown;
  comment?: unknown;
}

export interface NormalizedAddress {
  title: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  comment: string | null;
}

export type AddressValidation =
  | { ok: true; value: NormalizedAddress }
  | { ok: false; field: keyof AddressInput; message: string };

// Boshqaruv belgilari (\n, \t ham), ko'rinmas format belgilari (zero-width
// joiner va h.k.), qator/paragraf ajratgichlar. customer-validators.ts dagi
// ism tekshiruvi bilan bir xil to'plam.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const codePoints = (s: string) => Array.from(s).length;

type Fail = { ok: false; field: keyof AddressInput; message: string };
const fail = (field: keyof AddressInput, message: string): Fail => ({
  ok: false,
  field,
  message,
});

/** Bo'sh qiymat (undefined/null/bo'sh satr) = maydon berilmagan. */
const isBlank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Bir qatorli matn: chetidagi bo'shliqlar olinadi, ichkarisidagi ketma-ket
 * bo'shliqlar bittaga qisqartiriladi. Qaytadi: tozalangan satr yoki xato.
 */
function singleLine(
  field: keyof AddressInput,
  raw: unknown,
  min: number,
  max: number,
): { ok: true; value: string } | Fail {
  if (typeof raw !== 'string')
    return fail(field, `${field}: matn bo'lishi kerak`);
  const value = raw.trim().replace(/\s+/g, ' ');
  if (FORBIDDEN.test(value))
    return fail(field, `${field}: ruxsat etilmagan belgilar`);
  const length = codePoints(value);
  if (length < min || length > max)
    return fail(field, `${field}: ${min}-${max} belgi bo'lishi kerak`);
  return { ok: true, value };
}

/** Ixtiyoriy bir qatorli maydon: bo'sh -> null. */
function optionalSingleLine(
  field: keyof AddressInput,
  raw: unknown,
  max: number,
): { ok: true; value: string | null } | Fail {
  if (isBlank(raw)) return { ok: true, value: null };
  return singleLine(field, raw, 1, max);
}

/**
 * Izoh ("Orientir va tafsilotlar") ko'p qatorli bo'lishi mumkin: frontend'da
 * textarea. \r\n -> \n, uch va undan ko'p bo'sh qator ikkitaga qisqartiriladi,
 * boshqa boshqaruv belgilari rad etiladi.
 */
function multiLine(
  field: keyof AddressInput,
  raw: unknown,
  max: number,
): { ok: true; value: string | null } | Fail {
  if (isBlank(raw)) return { ok: true, value: null };
  if (typeof raw !== 'string')
    return fail(field, `${field}: matn bo'lishi kerak`);

  const value = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (FORBIDDEN.test(value.replace(/\n/g, '')))
    return fail(field, `${field}: ruxsat etilmagan belgilar`);
  if (codePoints(value) > max)
    return fail(field, `${field}: ${max} belgidan oshmasligi kerak`);
  return { ok: true, value };
}

const isCoordinate = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

// 6 xona ~ 0.1 m aniqlik. Xarita siljitilganda float "shovqini"
// (41.31108123456789) bazaga yozilmaydi.
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function normalizeAddressInput(input: AddressInput): AddressValidation {
  const address = singleLine(
    'address',
    input.address,
    ADDRESS_LIMITS.addressMin,
    ADDRESS_LIMITS.address,
  );
  if (!address.ok) return address;

  const title = optionalSingleLine('title', input.title, ADDRESS_LIMITS.title);
  if (!title.ok) return title;

  const entrance = optionalSingleLine(
    'entrance',
    input.entrance,
    ADDRESS_LIMITS.shortField,
  );
  if (!entrance.ok) return entrance;

  const floor = optionalSingleLine(
    'floor',
    input.floor,
    ADDRESS_LIMITS.shortField,
  );
  if (!floor.ok) return floor;

  const apartment = optionalSingleLine(
    'apartment',
    input.apartment,
    ADDRESS_LIMITS.shortField,
  );
  if (!apartment.ok) return apartment;

  const comment = multiLine('comment', input.comment, ADDRESS_LIMITS.comment);
  if (!comment.ok) return comment;

  const hasLat = input.latitude !== undefined && input.latitude !== null;
  const hasLon = input.longitude !== undefined && input.longitude !== null;
  if (hasLat !== hasLon) {
    return fail(
      hasLat ? 'longitude' : 'latitude',
      'latitude va longitude birga berilishi kerak',
    );
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (hasLat && hasLon) {
    if (
      !isCoordinate(input.latitude) ||
      input.latitude < -90 ||
      input.latitude > 90
    ) {
      return fail('latitude', "latitude -90 dan 90 gacha son bo'lishi kerak");
    }
    if (
      !isCoordinate(input.longitude) ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      return fail(
        'longitude',
        "longitude -180 dan 180 gacha son bo'lishi kerak",
      );
    }
    latitude = round6(input.latitude);
    longitude = round6(input.longitude);
  }

  return {
    ok: true,
    value: {
      title: title.value,
      address: address.value,
      latitude,
      longitude,
      entrance: entrance.value,
      floor: floor.value,
      apartment: apartment.value,
      comment: comment.value,
    },
  };
}
