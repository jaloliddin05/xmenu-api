import { Worker } from 'bullmq';
import axios from 'axios';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { redisConfig } from './bull.config';

@Injectable()
export class RevalidateProcessor implements OnModuleDestroy {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'revalidate-queue',
      async (job) => {
        const { url } = job.data;

        try {
          console.log(`🔄 Revalidating: ${url}`);
          const response = await axios.post(`${process.env.NEXT_PUBLIC_URL}/api/revalidate`,{route:'menu',slug:url,secret:process.env.REVALIDATE_SECRET});

          if (response.status === 200) {
            console.log(`✅ Success: ${url}`);
            return { success: true };
          } else {
            throw new Error(`Unexpected status: ${response.status}`);
          }
        } catch (error) {
          console.error(`❌ Failed revalidate ${url}:`, error.message);
        //   await this.telegram.sendMessage(`❌ Ошибка ревалидации\nURL: ${url}\nОшибка: ${error.message}`);
          throw error;
        }
      },
      { connection: redisConfig }
    );

    // Подписка на события очереди
    this.worker.on('failed', (job, err) => {
      console.error(`💥 Job failed for ${job?.data?.url}:`, err.message);
    });

    this.worker.on('completed', (job) => {
      console.log(`🎉 Job completed for ${job.data.url}`);
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
