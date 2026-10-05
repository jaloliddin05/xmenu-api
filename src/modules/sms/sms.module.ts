import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { EskizSmsProvider } from './providers/eskiz-sms.provider';
import { TelegramSmsProvider } from './providers/telegram-sms.provider';

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
            // SMS_PROVIDER=eskiz|telegram|console (default: production'da eskiz, aks holda console)
            provide: SMS_PROVIDER,
            useFactory: (c: ConsoleSmsProvider, e: EskizSmsProvider, t: TelegramSmsProvider) => {
                const name =
                    process.env.SMS_PROVIDER ||
                    (process.env.NODE_ENV === 'production' ? 'eskiz' : 'console');
                if (name === 'eskiz') return e;
                if (name === 'telegram') return t;
                if (name === 'console') return c;
                throw new Error(`Noma'lum SMS_PROVIDER: ${name}`);
            },
            inject: [ConsoleSmsProvider, EskizSmsProvider, TelegramSmsProvider],
        },
    ],
    exports: [SmsService, SMS_PROVIDER],
})
export class SmsModule { }
