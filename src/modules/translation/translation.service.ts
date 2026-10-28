import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../_prisma/prisma.service';


@Injectable()
export class TranslationService {
    private readonly logger = new Logger(TranslationService.name);
    private openai: OpenAI;

    constructor(
        private readonly prismaService: PrismaService
    ) {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async translate(text: string, promptName: string) {
        const prompt = await this.prismaService.translation_prompt.findFirst({ where: { title: promptName } })

        let response;
        try {
            response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'Ты переводчик меню для ресторана.' },
                {
                    role: 'user',
                    content: prompt?.context + '  ' + text,
                },
            ],
            temperature: 0.2,
            });
        } catch (e) {
            this.logger.error(`OpenAI request failed: ${(e as Error).message}`);
            throw new BadGatewayException('Translation service unavailable');
        }

        const content = response.choices[0]?.message?.content ?? '';

        try {
            return JSON.parse(this.clearJson(content));
        } catch (e) {
            this.logger.error('Invalid GPT response (not JSON)');
            throw new BadGatewayException('Invalid translation response');
        }
    }

    clearJson = (str) => {
        return str.replace(/```json/gi, "").replace(/```/g, "").trim();
    }
}
