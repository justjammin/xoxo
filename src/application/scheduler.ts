export type SchedulerOptions = { concurrency?: number };

/** Small bounded scheduler; queued work is started FIFO and cancellation is cooperative. */
export class Scheduler {
  private readonly concurrency: number;
  private active = 0;
  private queue: Array<() => Promise<void>> = [];
  private idleResolvers: Array<() => void> = [];

  constructor(options: SchedulerOptions = {}) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
  }

  add<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await work()); } catch (error) { reject(error); }
      });
      this.pump();
    });
  }

  async idle(): Promise<void> {
    if (!this.active && !this.queue.length) return;
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  get pending(): number { return this.queue.length; }
  get running(): number { return this.active; }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const work = this.queue.shift()!;
      this.active += 1;
      void work().finally(() => {
        this.active -= 1;
        this.pump();
        if (!this.active && !this.queue.length) {
          const waiters = this.idleResolvers.splice(0);
          for (const resolve of waiters) resolve();
        }
      });
    }
  }
}
