/**
 * Sliding-window rate limiter.
 * Tracks message timestamps per client and rejects messages
 * that exceed the configured rate.
 */
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private readonly maxMessages: number;
  private readonly windowMs: number;

  constructor(maxMessagesPerSecond: number) {
    this.maxMessages = maxMessagesPerSecond;
    this.windowMs = 1000; // 1 second sliding window
  }

  /**
   * Check if a client is allowed to send a message.
   * Returns true if allowed, false if rate-limited.
   */
  allow(clientId: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(clientId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(clientId, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxMessages) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Remove a client from the rate limiter (on disconnect).
   */
  remove(clientId: string): void {
    this.windows.delete(clientId);
  }

  /**
   * Periodic cleanup of stale entries.
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [clientId, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(clientId);
      }
    }
  }
}
