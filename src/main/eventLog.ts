import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class EventLogWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {}

  write(event: string, details: Record<string, unknown> = {}): void {
    const safeDetails = Object.fromEntries(Object.entries(details).filter(([key]) => {
      const normalized = key.toLowerCase();
      return !['apikey', 'apikeyenc', 'authorization', 'content', 'prompt', 'baseurl'].includes(normalized);
    }));
    const line = `${JSON.stringify({ schemaVersion: 1, ts: new Date().toISOString(), event, ...safeDetails })}\n`;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await mkdir(this.dataDirectory, { recursive: true });
      await appendFile(path.join(this.dataDirectory, 'events.log'), line, 'utf8');
    });
    void this.queue.catch(() => undefined);
  }
}
