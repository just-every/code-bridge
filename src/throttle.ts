export class Throttler {
  private lastCall = 0;
  private readonly delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  shouldAllow(): boolean {
    const now = Date.now();
    if (now - this.lastCall >= this.delayMs) {
      this.lastCall = now;
      return true;
    }
    return false;
  }
}
