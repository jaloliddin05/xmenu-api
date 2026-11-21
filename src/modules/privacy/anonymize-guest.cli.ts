/**
 * npm run privacy:delete-guest -- --tenant <id|slug> --phone +998XXXXXXXXX [--apply]
 * On the server: xdc exec -T api node dist/modules/privacy/anonymize-guest.cli.js --tenant ... (infra/docs/DEPLOY.md).
 * Talks to PostgreSQL only (no Redis, no queues). Dry run by default.
 */
import * as dotenv from 'dotenv';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { CustomerAnonymizerService } from 'src/modules/customer/services/customer-anonymizer.service';
import { errorMessage } from 'src/infra/helper/error-text';
import { parseArgs, runAnonymizeGuest } from './anonymize-guest';

dotenv.config({ quiet: true });

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    return 2;
  }
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const anonymizer = new CustomerAnonymizerService(prisma);
    const { lines, code } = await runAnonymizeGuest(args, {
      findTenantId: async (tenant) =>
        (
          await prisma.organization.findFirst({
            where: { OR: [{ id: tenant }, { slug: tenant }] },
            select: { id: true },
          })
        )?.id ?? null,
      findGuestId: (tenantId, phone) => anonymizer.findGuestId(tenantId, phone),
      deleteGuest: (tenantId, customerId, opts) =>
        anonymizer.deleteGuest(tenantId, customerId, opts),
    });
    console.log(lines.join('\n'));
    return code;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    // Error codes of the service (has_active_orders) are printed as is; no stack, no connection string
    console.error(
      `failed: ${(e as { code?: string }).code ?? errorMessage(e)}`,
    );
    process.exitCode = 1;
  });
