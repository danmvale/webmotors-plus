export type Priority = 'high' | 'low';

export interface ScheduleOptions {
  priority?: Priority;
  signal?: AbortSignal;
  /** Skip the minimum spacing (user-initiated one-off calls such as the AI search). */
  immediate?: boolean;
}

export interface SchedulerDeps {
  /** Minimum gap before a job starts, per priority of that job. */
  minSpacingMs: number | Readonly<Record<Priority, number>>;
  /** Background (low priority) work waits for this, e.g. until the tab is visible again. */
  whenReady?: (signal?: AbortSignal) => Promise<void>;
  /** Global, cross-tab admission control. Resolves with the delay to wait before starting. */
  acquire?: () => Promise<number>;
  /** Returns the epoch ms until which requests are paused (circuit breaker), if any. */
  blockedUntil?: () => number | undefined;
  onBlocked?: (until: number) => Error;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface Job {
  run: () => Promise<unknown>;
  priority: Priority;
  immediate: boolean;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs Webmotors requests one at a time, at least `minSpacingMs` apart,
 * user-initiated work first. Keeps the extension well below the request rate
 * that triggers the site's bot protection.
 */
export class RequestScheduler {
  private readonly queue: Job[] = [];
  private running = false;
  private lastStart = -Infinity;
  private readonly now: () => number;
  private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.wait = deps.sleep ?? sleep;
  }

  get pending(): number {
    return this.queue.length;
  }

  schedule<T>(run: () => Promise<T>, opts: ScheduleOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(abortError());
      const job: Job = {
        run,
        priority: opts.priority ?? 'low',
        immediate: opts.immediate ?? false,
        signal: opts.signal,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (job.priority === 'high') {
        const firstLow = this.queue.findIndex((j) => j.priority === 'low');
        this.queue.splice(firstLow === -1 ? this.queue.length : firstLow, 0, job);
      } else {
        this.queue.push(job);
      }
      opts.signal?.addEventListener(
        'abort',
        () => {
          const index = this.queue.indexOf(job);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(abortError());
          }
        },
        { once: true },
      );
      void this.pump();
    });
  }

  private spacing(priority: Priority): number {
    const { minSpacingMs } = this.deps;
    return typeof minSpacingMs === 'number' ? minSpacingMs : minSpacingMs[priority];
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        if (job.signal?.aborted) {
          job.reject(abortError());
          continue;
        }
        try {
          const until = this.deps.blockedUntil?.();
          if (until && until > this.now()) throw this.deps.onBlocked?.(until) ?? new Error('blocked');
          if (!job.immediate) {
            if (job.priority === 'low') await this.deps.whenReady?.(job.signal);
            await this.wait(this.lastStart + this.spacing(job.priority) - this.now(), job.signal);
            const delay = (await this.deps.acquire?.()) ?? 0;
            await this.wait(delay, job.signal);
          }
          this.lastStart = this.now();
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
