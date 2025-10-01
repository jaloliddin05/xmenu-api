import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../_prisma/prisma.service';


@Injectable()
export class TranslationService {
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

        const response = await this.openai.chat.completions.create({
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

        const content = response.choices[0].message?.content;

        try {
            return JSON.parse(this.clearJson(content));
        } catch (e) {
            throw new Error('Invalid GPT response: ' + content);
        }
    }

    clearJson = (str) => {
        return str.replace(/```json/gi, "").replace(/```/g, "").trim();
    }
}
