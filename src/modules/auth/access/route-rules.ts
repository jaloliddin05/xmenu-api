import { INestApplicationContext, RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLE_PERMISSIONS, STAFF_ROLES } from './permissions';
import type { StaffRole } from './permissions';
import { STAFF_ACCESS_KEY } from './staff-access.decorator';
import type { StaffAccessRule } from './staff-access.decorator';
import { STEP_UP_KEY } from '../step-up/step-up.decorator';
import type { StepUpAction } from '../step-up/step-up.decorator';

export interface RouteInfo {
  /** GET, POST, … */
  method: string;
  /** Express form: /organization/:id/settings */
  path: string;
  controller: Type;
  handler: string;
  /** 'public' (@Public on the method or the class), the StaffAccess rule, or null: no rule (denied) */
  rule: 'public' | StaffAccessRule | null;
  /** @StepUp: the critical action this route performs (needs X-Step-Up-Token) */
  stepUp?: StepUpAction;
}

const joinPath = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? (v as string[]) : [typeof v === 'string' ? v : ''];

/**
 * Every HTTP route of the application with its access rule, read from the controllers' metadata.
 * Works on an application created with `preview: true` (no database or Redis), like npm run openapi.
 */
export function collectRoutes(app: INestApplicationContext): RouteInfo[] {
  const controllers = new Set<Type>();
  for (const mod of app.get(ModulesContainer).values())
    for (const wrapper of mod.controllers.values())
      if (wrapper.metatype) controllers.add(wrapper.metatype as Type);

  const routes: RouteInfo[] = [];
  for (const controller of controllers) {
    const base = asList(Reflect.getMetadata(PATH_METADATA, controller));
    const classPublic = Reflect.getMetadata(PUBLIC_KEY, controller) === true;
    const proto = controller.prototype as Record<string, unknown>;
    for (const handler of Object.getOwnPropertyNames(proto)) {
      const fn = proto[handler];
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as
        | RequestMethod
        | undefined;
      if (method === undefined) continue;
      const isPublic =
        classPublic || Reflect.getMetadata(PUBLIC_KEY, fn) === true;
      const rule = isPublic
        ? 'public'
        : ((Reflect.getMetadata(STAFF_ACCESS_KEY, fn) as
            | StaffAccessRule
            | undefined) ?? null);
      const stepUp = Reflect.getMetadata(STEP_UP_KEY, fn) as
        | StepUpAction
        | undefined;
      for (const b of base)
        for (const p of asList(Reflect.getMetadata(PATH_METADATA, fn)))
          routes.push({
            method: RequestMethod[method],
            path: joinPath(b, p),
            controller,
            handler,
            rule,
            ...(stepUp ? { stepUp } : {}),
          });
    }
  }
  return routes.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/** :id → {id}, the OpenAPI form. */
export const openApiPath = (path: string) =>
  path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const ROLE_TITLE: Record<StaffRole, string> = {
  owner: 'Владелец',
  operator: 'Оператор',
};

/** Markdown table of the staff routes (the access matrix in docs/API.md). */
export function renderAccessMatrix(routes: RouteInfo[]): string {
  const staff = routes.filter(
    (r): r is RouteInfo & { rule: StaffAccessRule } =>
      r.rule !== 'public' && r.rule !== null,
  );
  const head = [
    '| Метод | Путь | Право | Заведение в пути | Пароль | ' +
      STAFF_ROLES.map((r) => ROLE_TITLE[r]).join(' | ') +
      ' |',
    '|---|---|---|---|---|' + STAFF_ROLES.map(() => '---').join('|') + '|',
  ];
  const rows = staff.map((r) => {
    const { permission, orgParam } = r.rule;
    const admin = permission === 'platform-admin';
    const cells = STAFF_ROLES.map((role) =>
      !admin && ROLE_PERMISSIONS[role].includes(permission) ? '✓' : '—',
    );
    const right = admin ? 'администратор платформы' : `\`${permission}\``;
    const org = orgParam ? `\`${orgParam}\`` : '';
    const stepUp = r.stepUp ? 'step-up' : '';
    return `| ${r.method} | \`${openApiPath(r.path)}\` | ${right} | ${org} | ${stepUp} | ${cells.join(' | ')} |`;
  });
  return [...head, ...rows].join('\n');
}
