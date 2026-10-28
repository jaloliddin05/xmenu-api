import { Worker } from 'bullmq';
import axios from 'axios';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { redisConfig } from './bull.config';
import { buildRevalidateBody, describeRevalidate } from './revalidate-job';

@Injectable()
export class RevalidateProcessor implements OnModuleDestroy {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'revalidate-queue',
      async (job) => {
        const { url } = job.data;
        const what = describeRevalidate(url, job.id);

        try {
          console.log(`🔄 Revalidating: ${what}`);
          const response = await axios.post(`${process.env.NEXT_PUBLIC_URL}/api/revalidate`,buildRevalidateBody(url, process.env.REVALIDATE_SECRET));

          if (response.status === 200) {
            console.log(`✅ Success: ${what}`);
            return { success: true };
          } else {
            throw new Error(`Unexpected status: ${response.status}`);
          }
        } catch (error) {
          console.error(`❌ Failed revalidate ${what}:`, error.message);
        //   await this.telegram.sendMessage(`❌ Ошибка ревалидации\nURL: ${url}\nОшибка: ${error.message}`);
          throw error;
        }
      },
      { connection: redisConfig }
    );

    // Подписка на события очереди
    this.worker.on('failed', (job, err) => {
      console.error(`💥 Job failed for ${describeRevalidate(job?.data?.url ?? {}, job?.id)}:`, err.message);
    });

    this.worker.on('completed', (job) => {
      console.log(`🎉 Job completed for ${describeRevalidate(job.data.url ?? {}, job.id)}`);
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
