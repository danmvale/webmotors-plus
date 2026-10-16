import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../src/lib/rate-limit';
import { isPxBlock, PxBlockedError } from '../src/lib/webmotors/px';
import { RequestScheduler } from '../src/lib/webmotors/scheduler';

describe('RequestScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spaces requests and runs them one at a time', async () => {
    const starts: number[] = [];
    const scheduler = new RequestScheduler({ minSpacingMs: 1200 });
    const job = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };
    const all = Promise.all([scheduler.schedule(job), scheduler.schedule(job), scheduler.schedule(job)]);
    await vi.runAllTimersAsync();
    await all;
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1200);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1200);
  });

  it('runs user-initiated work before background work', async () => {
    const order: string[] = [];
    const scheduler = new RequestScheduler({ minSpacingMs: 100 });
    const job = (name: string) => () => {
      order.push(name);
      return Promise.resolve();
    };
    const all = Promise.all([
      scheduler.schedule(job('low-1')),
      scheduler.schedule(job('low-2')),
      scheduler.schedule(job('high'), { priority: 'high' }),
    ]);
    await vi.runAllTimersAsync();
    await all;
    expect(order).toEqual(['low-1', 'high', 'low-2']);
  });

  it('spaces background work further apart than user actions', async () => {
    const starts: Array<[string, number]> = [];
    const scheduler = new RequestScheduler({ minSpacingMs: { high: 1000, low: 3000 } });
    const job = (name: string) => () => {
      starts.push([name, Date.now()]);
      return Promise.resolve();
    };
    const all = Promise.all([
      scheduler.schedule(job('a'), { priority: 'high' }),
      scheduler.schedule(job('b'), { priority: 'high' }),
      scheduler.schedule(job('c')),
    ]);
    await vi.runAllTimersAsync();
    await all;
    const t = Object.fromEntries(starts);
    expect(t.b! - t.a!).toBeGreaterThanOrEqual(1000);
    expect(t.b! - t.a!).toBeLessThan(3000);
    expect(t.c! - t.b!).toBeGreaterThanOrEqual(3000);
  });

  it('holds background work until the page is ready (e.g. tab visible)', async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (release = resolve));
    const scheduler = new RequestScheduler({ minSpacingMs: 0, whenReady: () => ready });
    const run = vi.fn(() => Promise.resolve());
    const done = scheduler.schedule(run);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
    release();
    await done;
    expect(run).toHaveBeenCalledOnce();
  });

  it('waits for the global token delay', async () => {
    const scheduler = new RequestScheduler({ minSpacingMs: 0, acquire: () => Promise.resolve(5000) });
    let done = false;
    void scheduler.schedule(() => Promise.resolve()).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });

  it('rejects immediately while the circuit is open', async () => {
    const until = Date.now() + 60_000;
    const run = vi.fn(() => Promise.resolve());
    const scheduler = new RequestScheduler({
      minSpacingMs: 0,
      blockedUntil: () => until,
      onBlocked: (u) => new PxBlockedError(u),
    });
    await expect(scheduler.schedule(run)).rejects.toBeInstanceOf(PxBlockedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('drops aborted jobs without running them', async () => {
    const scheduler = new RequestScheduler({ minSpacingMs: 1000 });
    const run = vi.fn(() => Promise.resolve());
    const controller = new AbortController();
    const first = scheduler.schedule(() => Promise.resolve());
    const second = expect(scheduler.schedule(run, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await vi.runAllTimersAsync();
    await first;
    await second;
    expect(run).not.toHaveBeenCalled();
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then paces to the rate', () => {
    let now = 0;
    const bucket = new TokenBucket(30, 2, () => now);
    expect(bucket.reserve()).toBe(0);
    expect(bucket.reserve()).toBe(0);
    expect(bucket.reserve()).toBe(2000);
    expect(bucket.reserve()).toBe(4000);
    now = 60_000;
    expect(bucket.reserve()).toBe(0);
  });

  it('restores its state after a restart', () => {
    let now = 0;
    const bucket = new TokenBucket(6, 2, () => now);
    bucket.reserve();
    bucket.reserve();
    const restarted = new TokenBucket(6, 2, () => now);
    restarted.restore(bucket.state);
    expect(restarted.reserve()).toBe(10_000);
  });
});

describe('isPxBlock', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  it('detects PerimeterX block bodies and edge responses', async () => {
    expect(await isPxBlock(json(403, { appId: 'PX7Vv0zOst', uuid: 'x', blockScript: '/b.js' }))).toBe(true);
    expect(await isPxBlock(json(403, {}, { 'x-cache': 'LambdaGeneratedResponse' }))).toBe(true);
    expect(await isPxBlock(new Response('<div id="px-captcha"></div>', { status: 403 }))).toBe(true);
    expect(await isPxBlock(json(429, {}))).toBe(true);
  });

  it('ignores normal responses and unrelated errors', async () => {
    expect(await isPxBlock(json(200, { Count: 1 }))).toBe(false);
    expect(await isPxBlock(json(500, { error: 'x' }))).toBe(false);
    expect(await isPxBlock(json(403, { message: 'forbidden' }))).toBe(false);
  });
});
