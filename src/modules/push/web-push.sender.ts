import { Injectable } from '@nestjs/common';
import * as webPush from 'web-push';
import { loadWebPushConfig, type WebPushConfig } from './push.config';

export const WEB_PUSH_SENDER = Symbol('WEB_PUSH_SENDER');

/** A browser subscription as the push service needs it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendOptions {
  /** Seconds the push service keeps an undelivered message */
  ttl: number;
  /** Replaces an undelivered message with the same topic (base64url, at most 32 characters) */
  topic: string;
}

/** How one send ended, by the push service's answer. */
export type PushSendResult =
  | { kind: 'sent' }
  /** 404 / 410: the subscription is gone for good */
  | { kind: 'gone'; status: number }
  /** Another 4xx: the same request will not succeed later */
  | { kind: 'rejected'; status: number }
  /** 429, 5xx, network: worth another attempt */
  | { kind: 'retry'; status: number | null };

export interface PushSender {
  /** Null: web push is off on this platform (no VAPID keys). */
  readonly publicKey: string | null;
  send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<PushSendResult>;
}

/** Sorts a push service status into what to do with the subscription. */
export function pushResult(status: number | null): PushSendResult {
  if (status !== null && status >= 200 && status < 300) return { kind: 'sent' };
  if (status === 404 || status === 410) return { kind: 'gone', status };
  if (status !== null && status >= 400 && status < 500 && status !== 429)
    return { kind: 'rejected', status };
  return { kind: 'retry', status };
}

/**
 * web-push: VAPID (ES256 JWT) and the aes128gcm payload encryption (RFC 8291). Messages go with urgency high:
 * a new order must wake a phone in power saving.
 */
@Injectable()
export class WebPushSender implements PushSender {
  private readonly config: WebPushConfig | null = loadWebPushConfig();

  get publicKey(): string | null {
    return this.config?.publicKey ?? null;
  }

  async send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<PushSendResult> {
    if (!this.config) throw new Error('web push is not configured');
    try {
      const res = await webPush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        {
          TTL: options.ttl,
          urgency: 'high',
          topic: options.topic,
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
          timeout: 10_000,
        },
      );
      return pushResult(res.statusCode);
    } catch (e) {
      return pushResult(
        e instanceof webPush.WebPushError ? e.statusCode : null,
      );
    }
  }
}
