export class RendererRecovery {
  private attempts: number[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(
    private reload: () => void,
    private exhausted: () => void,
    private now = () => Date.now(),
    private delay = 1000,
  ) {}
  gone(reason: string) {
    if (this.closed || reason === "clean-exit" || this.timer) return;
    this.attempts = this.attempts.filter(
      (time) => this.now() - time < 5 * 60 * 1000,
    );
    if (this.attempts.length >= 3) {
      this.exhausted();
      return;
    }
    this.attempts.push(this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.closed) this.reload();
    }, this.delay * this.attempts.length);
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
