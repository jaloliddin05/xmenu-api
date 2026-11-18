import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { iikoApiBaseUrl } from 'src/infra/iiko/iiko-api-url';
import {
  AppException,
  platformMisconfigured,
} from 'src/infra/errors/app-exception';
import type { ErrorCode } from 'src/infra/errors/error-codes';
import type { PosCredentials } from '../provider/pos-provider';

const DEFAULT_TIMEOUT_MS = 15_000;
/** A token is renewed this long before its `exp` */
const TOKEN_MARGIN_MS = 5 * 60_000;
/** Lifetime when the token carries no readable `exp` (iiko: 1 hour) */
const TOKEN_FALLBACK_MS = 60 * 60_000;
const TOKEN_PATH = '/api/v2/access_token';
/** A token refusal naming the integrator application, not the restaurant's key */
const APP_REJECTED = /app\s*id|client\s*secret|application|приложени/i;

/**
 * Why an iiko call failed, safe to log: the HTTP status and iiko's own error code, never the request
 * (it carries the key or the token) and never the response text (it may echo guest data).
 */
export class IikoApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    readonly iikoCode: string | null,
    readonly code: ErrorCode,
  ) {
    super(
      `iiko ${path}: ${status ?? 'no response'}${iikoCode ? ` ${iikoCode}` : ''}`,
    );
  }
}

/** Error code for an HTTP status of iiko (docs/IIKO.md, "Проверка документации", 6). */
export function iikoStatusCode(status: number | null): ErrorCode {
  switch (status) {
    case 401:
      return 'pos_key_invalid';
    case 402:
      return 'pos_module_missing';
    case 403:
      return 'pos_access_denied';
    case 423:
      return 'pos_access_blocked';
    default:
      return 'pos_unavailable';
  }
}

/** Expiry of a JWT from its `exp` claim (ms), or null. The signature is iiko's business. */
export function jwtExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const { exp } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Safe to log: the reason of an iiko failure without the key, token or response body. */
export function iikoErrorText(e: unknown): string {
  if (e instanceof IikoApiError) return e.message;
  if (e instanceof AppException && typeof e.cause === 'string')
    return `${e.message}: ${e.cause}`;
  return e instanceof Error ? e.message : 'unknown';
}

/** Turns a failed call into the error the owner sees (by code) with the reason in the log only. */
export function toAppException(e: unknown): AppException {
  if (e instanceof AppException) return e;
  if (e instanceof IikoApiError)
    return new AppException(e.code, { cause: e.message });
  return new AppException('pos_unavailable', { cause: iikoErrorText(e) });
}

interface CachedToken {
  token: string;
  /** sha256 of the key the token was issued for: a new key never reuses an old token */
  keyHash: string;
  renewAt: number;
}

/**
 * iiko Cloud API transport: the v2 access token (the Xmenu application `appId` + `clientSecret`
 * from the environment and the restaurant's `apiKey`), kept in process memory until shortly
 * before `exp` and requested again once on 401. Never stores the token anywhere else.
 */
@Injectable()
export class IikoApiClient {
  private readonly tokens = new Map<string, CachedToken>();
  private lastTokenAt = 0;

  /** When this process last got a token (ms; 0: never): the integrator application works then. */
  get lastTokenIssuedAt(): number {
    return this.lastTokenAt;
  }

  private app(): { appId: string; clientSecret: string } {
    const appId = process.env.IIKO_APP_ID?.trim();
    const clientSecret = process.env.IIKO_CLIENT_SECRET?.trim();
    if (!appId || !clientSecret)
      throw platformMisconfigured(
        'pos',
        'IIKO_APP_ID or IIKO_CLIENT_SECRET is not set: no iiko access token',
      );
    return { appId, clientSecret };
  }

  /** Forgets the token of an integration (key replaced or integration removed). */
  forget(integrationId: string): void {
    this.tokens.delete(integrationId);
  }

  async token(cred: PosCredentials, fresh = false): Promise<string> {
    const keyHash = createHash('sha256').update(cred.apiKey).digest('hex');
    const cached = this.tokens.get(cred.integrationId);
    if (
      !fresh &&
      cached &&
      cached.keyHash === keyHash &&
      cached.renewAt > Date.now()
    )
      return cached.token;
    let data: { token?: unknown };
    try {
      data = await this.send<{ token?: unknown }>(
        TOKEN_PATH,
        { ...this.app(), apiKey: cred.apiKey },
        null,
      );
    } catch (e) {
      // The Xmenu application is rejected, not the venue: no venue is asked to reconnect
      if (e instanceof IikoApiError && e.code === 'platform_misconfigured')
        throw platformMisconfigured(
          'pos',
          `iiko rejected the integrator application (${e.message})`,
        );
      throw e;
    }
    const { token } = data;
    if (typeof token !== 'string' || !token)
      throw new IikoApiError(TOKEN_PATH, 200, null, 'pos_unavailable');
    const exp = jwtExpiry(token) ?? Date.now() + TOKEN_FALLBACK_MS;
    this.tokens.set(cred.integrationId, {
      token,
      keyHash,
      renewAt: exp - TOKEN_MARGIN_MS,
    });
    this.lastTokenAt = Date.now();
    return token;
  }

  /** A call with the venue's token; on 401 the token is requested again once. */
  async call<T>(
    cred: PosCredentials,
    path: string,
    body: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    try {
      return await this.send<T>(path, body, await this.token(cred), timeoutMs);
    } catch (e) {
      if (!(e instanceof IikoApiError) || e.status !== 401) throw e;
      const token = await this.token(cred, true);
      return this.send<T>(path, body, token, timeoutMs);
    }
  }

  private async send<T>(
    path: string,
    body: unknown,
    token: string | null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    try {
      const { data } = await axios.post<T>(`${iikoApiBaseUrl()}${path}`, body, {
        timeout: timeoutMs,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        // Redirects could carry the token to another host
        maxRedirects: 0,
      });
      return data;
    } catch (e: unknown) {
      // Never rethrow the axios error: its config holds the key or the token
      const status = axios.isAxiosError(e)
        ? (e.response?.status ?? null)
        : null;
      const data: unknown = axios.isAxiosError(e)
        ? e.response?.data
        : undefined;
      const iikoCode =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error).slice(0, 80)
          : null;
      // A rejected key on the token call is a 401 or a 400 (iiko answers 400 to an unknown key);
      // a refusal that names the application is the platform's (its text is read, never logged)
      const description =
        data && typeof data === 'object' && 'errorDescription' in data
          ? String((data as { errorDescription: unknown }).errorDescription)
          : '';
      const refused = path === TOKEN_PATH && (status === 400 || status === 401);
      const code = !refused
        ? iikoStatusCode(status)
        : APP_REJECTED.test(`${iikoCode ?? ''} ${description}`)
          ? 'platform_misconfigured'
          : 'pos_key_invalid';
      throw new IikoApiError(path, status, iikoCode, code);
    }
  }
}
