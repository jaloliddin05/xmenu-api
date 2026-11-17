import type { PrismaService } from 'src/modules/_prisma/prisma.service';
import type { FieldError } from 'src/infra/errors/app-exception';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';

/**
 * Menu rows imported from a POS (pos_menu_link) are read-only where the POS leads (docs/IIKO.md,
 * "Меню"): the name in the language of the POS names, prices, option groups and options, the
 * category; deleting them. Other translations, descriptions, pictures, order and hiding stay editable.
 * Disconnecting the POS removes the links and everything becomes editable again.
 */
export type MenuLinkTarget =
  | { category_id: string }
  | { product_id: string }
  | { group_id: string }
  | { option_id: string };

/** Language of the POS names when the row is linked to a POS, otherwise null. */
export async function posSourceLang(
  prisma: PrismaService,
  where: MenuLinkTarget,
): Promise<string | null> {
  const link = await prisma.pos_menu_link.findFirst({
    where,
    select: { integration: { select: { source_lang: true } } },
  });
  return link ? (link.integration.source_lang ?? '') : null;
}

/**
 * `pos` in the owner's menu responses: null for an ordinary row; for a POS row `managed: true` (the
 * dashboard shows the POS fields read-only) and `hiddenInPos` (gone from the POS or hidden there).
 */
export const posMarker = (
  link: { hidden_in_pos: boolean } | null | undefined,
) => (link ? { managed: true, hiddenInPos: link.hidden_in_pos } : null);

const problem = (field: string): FieldError => ({
  field,
  code: 'pos_managed',
  message: 'Managed by the POS',
});

/** Scalar fields sent with a value different from the current one. */
export function changedFields(
  current: Record<string, unknown>,
  sent: Record<string, unknown>,
): FieldError[] {
  return Object.entries(sent)
    .filter(([key, value]) => value !== undefined && value !== current[key])
    .map(([key]) => problem(key));
}

/**
 * Translations updated by id: the one in the POS language keeps its title, and no other one may
 * take that language.
 */
export function sourceTranslationProblems(
  sourceLang: string,
  existing: { id: string; lang: string; title: string }[],
  sent: { id?: string; lang?: string; title?: string }[] = [],
): FieldError[] {
  const out: FieldError[] = [];
  sent.forEach((t, i) => {
    const was = t.id ? existing.find((e) => e.id === t.id) : undefined;
    const lang = t.lang ?? was?.lang;
    if (was?.lang === sourceLang) {
      if (lang !== sourceLang) out.push(problem(`translations[${i}].lang`));
      if (t.title !== undefined && t.title !== was.title)
        out.push(problem(`translations[${i}].title`));
    } else if (lang === sourceLang) {
      out.push(problem(`translations[${i}].lang`));
    }
  });
  return out;
}

export function assertNoManagedChanges(problems: FieldError[]): void {
  if (problems.length)
    throw fieldErrorsException('pos_managed_field', problems);
}

/** Deleting a row the POS leads: 409 pos_managed_field. */
export function assertNotManaged(sourceLang: string | null): void {
  if (sourceLang !== null) assertNoManagedChanges([problem('id')]);
}
