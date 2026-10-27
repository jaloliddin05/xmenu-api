import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { EskizSmsProvider } from './providers/eskiz-sms.provider';
import { TelegramSmsProvider } from './providers/telegram-sms.provider';

export type SmsProviderName = 'eskiz' | 'telegram' | 'console';

/** SMS_PROVIDER=eskiz|telegram|console (default: eskiz in production, console elsewhere). */
export function resolveSmsProviderName(env: NodeJS.ProcessEnv = process.env): SmsProviderName {
    const isProd = env.NODE_ENV === 'production';
    const name = env.SMS_PROVIDER || (isProd ? 'eskiz' : 'console');
    if (name !== 'eskiz' && name !== 'telegram' && name !== 'console') {
        throw new Error(`Noma'lum SMS_PROVIDER: ${name}`);
    }
    // Fail at boot, not on the first OTP: console would silently swallow every code
    if (isProd && name === 'console') {
        throw new Error('SMS_PROVIDER=console is not allowed when NODE_ENV=production');
    }
    return name;
}

@Module({
    imports: [
        HttpModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                timeout: configService.get('HTTP_TIMEOUT'),
                maxRedirects: configService.get('HTTP_MAX_REDIRECTS'),
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [
        SmsService,
        ConsoleSmsProvider,
        EskizSmsProvider,
        TelegramSmsProvider,
        {
            provide: SMS_PROVIDER,
            useFactory: (c: ConsoleSmsProvider, e: EskizSmsProvider, t: TelegramSmsProvider) => {
                const name = resolveSmsProviderName();
                if (name === 'eskiz') return e;
                if (name === 'telegram') return t;
                return c;
            },
            inject: [ConsoleSmsProvider, EskizSmsProvider, TelegramSmsProvider],
        },
    ],
    exports: [SmsService, SMS_PROVIDER],
})
export class SmsModule { }
