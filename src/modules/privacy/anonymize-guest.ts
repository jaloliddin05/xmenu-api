import {
  isValidPhone,
  maskPhone,
} from 'src/infra/helper/auth/customer-validators';
import type { AnonymizeGuestResult } from 'src/modules/customer/services/customer-anonymizer.service';

export interface AnonymizeGuestArgs {
  tenant: string;
  phone: string;
  apply: boolean;
}

/** `--tenant <organization id or slug> --phone +998XXXXXXXXX [--apply]`; dry run unless `--apply`. */
export function parseArgs(argv: string[]): AnonymizeGuestArgs | string {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const tenant = value('--tenant');
  const phone = value('--phone');
  if (!tenant) return '--tenant <organization id or slug> is required';
  if (!isValidPhone(phone)) return '--phone must look like +998XXXXXXXXX';
  return { tenant, phone, apply: argv.includes('--apply') };
}

export interface AnonymizeGuestDeps {
  /** organization id by id or slug; null if there is none */
  findTenantId: (tenant: string) => Promise<string | null>;
  findGuestId: (tenantId: string, phone: string) => Promise<string | null>;
  deleteGuest: (
    tenantId: string,
    customerId: string,
    opts: { dryRun: boolean },
  ) => Promise<AnonymizeGuestResult>;
}

/**
 * Manual deletion of a guest by venue and phone (docs/LAUNCH.md, 4.6) through the same service as DELETE
 * /customers/me. Returns the lines to print and the exit code; the phone is masked in the output.
 */
export async function runAnonymizeGuest(
  args: AnonymizeGuestArgs,
  deps: AnonymizeGuestDeps,
): Promise<{ lines: string[]; code: number }> {
  const tenantId = await deps.findTenantId(args.tenant);
  if (!tenantId) return { lines: ['venue not found'], code: 1 };
  const customerId = await deps.findGuestId(tenantId, args.phone);
  if (!customerId)
    return {
      lines: [`no guest with phone ${maskPhone(args.phone)} in this venue`],
      code: 1,
    };
  const r = await deps.deleteGuest(tenantId, customerId, {
    dryRun: !args.apply,
  });
  const verb = r.dryRun ? 'would change' : 'changed';
  return {
    lines: [
      r.dryRun ? 'DRY RUN: nothing was written, add --apply to run' : 'APPLIED',
      `guest ${customerId} (${maskPhone(args.phone)}): ${verb}`,
      `  addresses deleted: ${r.addresses}`,
      `  sessions revoked: ${r.sessions}`,
      `  auth events cleared: ${r.authEvents}`,
      `  orders anonymized: ${r.orders}`,
      '  the guest row loses phone, name and Telegram id',
    ],
    code: 0,
  };
}
