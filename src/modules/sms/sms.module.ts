import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { EskizSmsProvider } from './providers/eskiz-sms.provider';
import { TelegramSmsProvider } from './providers/telegram-sms.provider';
import { Env, EnvIssues, isProduction } from 'src/config/env/env-issues';

export type SmsProviderName = 'eskiz' | 'telegram' | 'console';

/** SMS_PROVIDER=eskiz|telegram|console (default: eskiz in production, console elsewhere). */
export function resolveSmsProviderName(
  env: NodeJS.ProcessEnv = process.env,
): SmsProviderName {
  const isProd = env.NODE_ENV === 'production';
  const name = env.SMS_PROVIDER || (isProd ? 'eskiz' : 'console');
  if (name !== 'eskiz' && name !== 'telegram' && name !== 'console') {
    throw new Error('SMS_PROVIDER must be eskiz, telegram or console');
  }
  // Fail at boot, not on the first OTP: console would silently swallow every code
  if (isProd && name === 'console') {
    throw new Error(
      'SMS_PROVIDER=console is not allowed when NODE_ENV=production',
    );
  }
  return name;
}

/**
 * Whether the chosen provider has what it needs to send: eskiz its credentials, telegram the OTP
 * group bot and chat (OTP_BOT, XMENU_CHAT_ID), console a non-production run (production refuses it
 * at boot). A static configuration check, not a probe of the provider: a provider that is down
 * still answers 503 sms_unavailable per request.
 */
export function isSmsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console')
    return false;
  switch (resolveSmsProviderName(env)) {
    case 'eskiz':
      return Boolean(env.ESKIZ_EMAIL && env.ESKIZ_PASSWORD);
    case 'telegram':
      return Boolean(env.OTP_BOT && env.XMENU_CHAT_ID);
    case 'console':
      return true;
  }
}

/**
 * Startup check (validateEnv): a known provider, never console in production, and in production a
 * provider that has what it needs (owners could not sign up and customers could not log in otherwise).
 */
export function smsEnvIssues(env: Env = process.env): EnvIssues {
  const issues: EnvIssues = { errors: [], warnings: [] };
  const raw = env.SMS_PROVIDER;
  if (raw && raw !== 'eskiz' && raw !== 'telegram' && raw !== 'console') {
    issues.errors.push('SMS_PROVIDER must be eskiz, telegram or console');
    return issues;
  }
  if (isProduction(env) && raw === 'console') {
    issues.errors.push(
      'SMS_PROVIDER=console is not allowed when NODE_ENV=production',
    );
    return issues;
  }
  const name = resolveSmsProviderName(env);
  if (isProduction(env) && !isSmsConfigured(env)) {
    issues.errors.push(
      name === 'eskiz'
        ? 'SMS_PROVIDER=eskiz needs ESKIZ_EMAIL and ESKIZ_PASSWORD'
        : 'SMS_PROVIDER=telegram needs OTP_BOT and XMENU_CHAT_ID',
    );
  }
  return issues;
}

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        timeout: configService.get('HTTP_TIMEOUT'),
        maxRedirects: configService.get('HTTP_MAX_REDIRECTS'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    ConsoleSmsProvider,
    EskizSmsProvider,
    TelegramSmsProvider,
    {
      provide: SMS_PROVIDER,
      useFactory: (
        c: ConsoleSmsProvider,
        e: EskizSmsProvider,
        t: TelegramSmsProvider,
      ) => {
        const name = resolveSmsProviderName();
        if (name === 'eskiz') return e;
        if (name === 'telegram') return t;
        return c;
      },
      inject: [ConsoleSmsProvider, EskizSmsProvider, TelegramSmsProvider],
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
