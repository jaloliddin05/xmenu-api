import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LiveEventBus } from './live-event-bus';
import { LiveStreamService } from './live-stream.service';

export const LIVE_STATS_EVERY_MS = 5 * 60_000;

/** The stats line of this process: open streams and events since the previous line. */
export function liveStatsLine(
  gauges: {
    staff: number;
    guest: number;
    public: number;
    verification: number;
  },
  delta: { events: number; resyncs: number; failures: number },
): string {
  return (
    `live streams staff=${gauges.staff} guest=${gauges.guest} public=${gauges.public} verification=${gauges.verification} ` +
    `events_5m=${delta.events} resyncs_5m=${delta.resyncs} failed_5m=${delta.failures}`
  );
}

/** One log line every 5 minutes per API process (observability, docs/API.md, "События (SSE)"). */
@Injectable()
export class LiveStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Live');
  private timer?: NodeJS.Timeout;
  private last = { events: 0, resyncs: 0, failures: 0 };

  constructor(
    private readonly bus: LiveEventBus,
    private readonly streams: LiveStreamService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.log(), LIVE_STATS_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  log() {
    const now = { ...this.bus.counters };
    this.logger.log(
      liveStatsLine(this.streams.gauges, {
        events: now.events - this.last.events,
        resyncs: now.resyncs - this.last.resyncs,
        failures: now.failures - this.last.failures,
      }),
    );
    this.last = now;
  }
}
