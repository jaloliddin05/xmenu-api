import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from 'src/infra/redis/redis.module';
import { AppException } from 'src/infra/errors/app-exception';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { RateLimitService } from 'src/modules/auth/services/rate-limit.service';
import { TelegramApiService } from './telegram-api.service';
import { LiveEventBus } from 'src/modules/live/live-event-bus';

export const BIND_CODE_LENGTH = 8;
export const BIND_CODE_TTL_SECONDS = 600;
/** No 0/O and 1/I: the code is read from the screen and typed into Telegram by hand. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BIND_WINDOW_SECONDS = 600;
const BIND_CHAT_LIMIT = 5;

const codeKey = (hash: string) => `branch-chat:code:${hash}`;
const activeKey = (branchId: string) => `branch-chat:active:${branchId}`;
const hashCode = (code: string) =>
  createHash('sha256').update(code).digest('hex');

export function newBindCode(): string {
  let code = '';
  for (let i = 0; i < BIND_CODE_LENGTH; i++)
    code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** `/bind CODE` (also `/bind@bot CODE`) → the code as typed, upper-cased; null if the text is no /bind command. */
export function parseBindCommand(text: unknown): string | null | undefined {
  if (typeof text !== 'string') return undefined;
  const m = /^\/bind(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(text.trim());
  if (!m) return undefined;
  return m[1] ? m[1].toUpperCase() : null;
}

export type BindResult =
  | { status: 'bound'; branchTitle: string }
  | { status: 'invalid' }
  | { status: 'rate_limited' };

/**
 * The branch chat is set only from the chat itself (S-09): the owner asks for a one-time code in the dashboard and
 * sends `/bind CODE` to the platform bot in the group. Redis keeps only the sha256 of the code for 10 minutes, one
 * active code per branch; a code works once. Attempts are limited per chat.
 */
@Injectable()
export class BranchChatBindingService {
  private readonly logger = new Logger('BranchChatBinding');
  private botUsername?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly telegram: TelegramApiService,
    @Inject(REDIS) private readonly redis: Redis,
    @Optional() private readonly live?: LiveEventBus,
  ) {}

  async createCode(
    organizationId: string,
    branchId: string,
  ): Promise<{ code: string; expiresIn: number; botUsername: string | null }> {
    await this.requireOwn(organizationId, branchId);
    const code = newBindCode();
    const hash = hashCode(code);
    const previous = await this.redis.get(activeKey(branchId));
    const tx = this.redis.multi();
    if (previous) tx.del(codeKey(previous));
    tx.set(codeKey(hash), branchId, 'EX', BIND_CODE_TTL_SECONDS);
    tx.set(activeKey(branchId), hash, 'EX', BIND_CODE_TTL_SECONDS);
    await tx.exec();
    return {
      code,
      expiresIn: BIND_CODE_TTL_SECONDS,
      botUsername: await this.platformBotUsername(),
    };
  }

  async unbind(organizationId: string, branchId: string): Promise<void> {
    await this.requireOwn(organizationId, branchId);
    await this.prisma.branch.update({
      where: { id: branchId },
      data: { telegram_chat_id: null },
    });
  }

  /** `/bind CODE` from a group chat. Never throws for a wrong code: the answer goes back to the chat. */
  async bind(chatId: string, code: string): Promise<BindResult> {
    try {
      await this.rateLimit.hit([
        {
          key: `branch-chat:bind:rl:${chatId}`,
          limit: BIND_CHAT_LIMIT,
          ttlSeconds: BIND_WINDOW_SECONDS,
        },
      ]);
    } catch (err) {
      if (err instanceof AppException && err.code === 'rate_limited')
        return { status: 'rate_limited' };
      throw err;
    }
    const hash = hashCode(code);
    const branchId = await this.redis.getdel(codeKey(hash));
    if (!branchId) return { status: 'invalid' };
    if ((await this.redis.get(activeKey(branchId))) === hash)
      await this.redis.del(activeKey(branchId));

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, title: true, organization_id: true },
    });
    if (!branch) return { status: 'invalid' };
    await this.prisma.branch.update({
      where: { id: branch.id },
      data: { telegram_chat_id: chatId },
    });
    this.logger.log(`branch ${branch.id} bound to chat ${chatId}`);
    // The dashboard shows the code until this event comes (no polling of the branch list)
    await this.live?.publish(branch.organization_id, {
      type: 'branch.chat_bound',
      data: { branchId: branch.id },
      to: ['staff'],
    });
    return { status: 'bound', branchTitle: branch.title };
  }

  private async platformBotUsername(): Promise<string | null> {
    if (!this.botUsername) {
      const me = await this.telegram.getMe();
      if (me?.username) this.botUsername = me.username;
    }
    return this.botUsername ?? null;
  }

  private async requireOwn(organizationId: string, id: string) {
    const b = await this.prisma.branch.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true },
    });
    if (!b)
      throw new AppException('not_found', { message: 'Branch not found' });
  }
}
