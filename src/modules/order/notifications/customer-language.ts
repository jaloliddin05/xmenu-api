import { isLang, type Lang } from 'src/infra/http/request-helpers';
import { PrismaService } from 'src/modules/_prisma/prisma.service';

/**
 * Language for a message to a customer: their stored language while the venue still offers it,
 * otherwise the venue default (organization_settings).
 */
export async function customerLangFor(
  prisma: PrismaService,
  organizationId: string,
  customerLanguage: string | null | undefined,
): Promise<Lang> {
  const settings = await prisma.organization_settings.findUnique({
    where: { organization_id: organizationId },
    select: { default_language: true, languages: true },
  });
  if (
    isLang(customerLanguage) &&
    settings?.languages.includes(customerLanguage)
  )
    return customerLanguage;
  return isLang(settings?.default_language) ? settings.default_language : 'ru';
}
