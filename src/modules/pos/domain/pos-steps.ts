import type { PosCheck } from '../provider/pos-provider';

/** Connection steps (docs/IIKO.md, "Подключение заведения"); the key step is done once a row exists. */
export const POS_STEPS = [
  'key',
  'organization',
  'branches',
  'payments',
  'menu',
] as const;
export type PosStep = (typeof POS_STEPS)[number];

export interface PosStepState {
  externalOrgId: string | null;
  addressFormat: string | null;
  branchLinks: number;
  /** Payment methods linked to POS payment types */
  paymentMethods: string[];
  /** Methods that need a link: cash always (pickup), card and online when the venue offers them */
  requiredPaymentMethods: string[];
  deliveryItemId: string | null;
  externalMenuId: string | null;
}

/** Payment methods that must be linked: pickup always takes cash; delivery adds what the venue switched on. */
export function requiredPaymentMethods(settings: {
  delivery_pay_card: boolean;
  delivery_pay_online: boolean;
}): string[] {
  return [
    'cash',
    ...(settings.delivery_pay_card ? ['card'] : []),
    ...(settings.delivery_pay_online ? ['online'] : []),
  ];
}

export function stepStatus(s: PosStepState): Record<PosStep, 'done' | 'todo'> {
  const done = (ok: boolean) => (ok ? 'done' : 'todo');
  return {
    key: 'done',
    organization: done(Boolean(s.externalOrgId && s.addressFormat)),
    branches: done(s.branchLinks > 0),
    payments: done(
      Boolean(s.deliveryItemId) &&
        s.requiredPaymentMethods.every((m) => s.paymentMethods.includes(m)),
    ),
    menu: done(Boolean(s.externalMenuId)),
  };
}

/**
 * What blocks enabling: unfinished steps (`step:<name>`) and checks that are not green
 * (`check:<key>`, `check:terminal_alive:<branchId>`).
 */
export function missingForEnable(
  steps: Record<PosStep, 'done' | 'todo'>,
  checks: PosCheck[],
): string[] {
  const missing: string[] = POS_STEPS.filter((s) => steps[s] === 'todo').map(
    (s) => `step:${s}`,
  );
  for (const c of checks)
    if (c.status !== 'ok')
      missing.push(
        c.branchId ? `check:${c.key}:${c.branchId}` : `check:${c.key}`,
      );
  return missing;
}
