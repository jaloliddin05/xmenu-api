import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../_prisma/prisma.service';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  // Created on first use: the API must start without OPENAI_API_KEY (translation is optional).
  private openai?: OpenAI;

  constructor(private readonly prismaService: PrismaService) {}

  private client(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'translation_unavailable',
        message: 'Translation is not configured',
      });
    }
    this.openai ??= new OpenAI({ apiKey });
    return this.openai;
  }

  async translate(text: string, promptName: string) {
    const openai = this.client();
    const prompt = await this.prismaService.translation_prompt.findFirst({
      where: { title: promptName },
    });

    let response;
    try {
      response = await openai.chat.completions.create({
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
      throw new BadGatewayException({
        code: 'translation_failed',
        message: 'Translation service unavailable',
      });
    }

    const content = response.choices[0]?.message?.content ?? '';

    try {
      return JSON.parse(this.clearJson(content));
    } catch (e) {
      this.logger.error('Invalid GPT response (not JSON)');
      throw new BadGatewayException({
        code: 'translation_failed',
        message: 'Invalid translation response',
      });
    }
  }

  clearJson = (str) => {
    return str
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
  };
}
