export interface BucketState {
  tokens: number;
  updatedAt: number;
}

/**
 * Reservation-based token bucket: `reserve()` books the next free slot and
 * returns how long the caller must wait before using it.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private readonly refillPerMs: number;

  constructor(
    ratePerMinute: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = burst;
    this.updatedAt = now();
    this.refillPerMs = ratePerMinute / 60_000;
  }

  /** Survives service-worker restarts when saved and restored by the caller. */
  get state(): BucketState {
    return { tokens: this.tokens, updatedAt: this.updatedAt };
  }

  restore(state: BucketState | undefined): void {
    if (!state || !Number.isFinite(state.tokens) || !Number.isFinite(state.updatedAt)) return;
    this.tokens = Math.min(this.burst, state.tokens);
    this.updatedAt = Math.min(state.updatedAt, this.now());
  }

  reserve(): number {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + (t - this.updatedAt) * this.refillPerMs);
    this.updatedAt = t;
    this.tokens -= 1;
    return this.tokens >= 0 ? 0 : Math.ceil(-this.tokens / this.refillPerMs);
  }
}
