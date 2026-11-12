export class Availability {
  id: number | null = null;
  constructor(
    public blocker: {
      start: (type: "prevent-app-suspension") => number;
      stop: (id: number) => unknown;
    },
  ) {}
  update(enabled: boolean, onBattery: boolean) {
    const want = enabled && !onBattery;
    if (want && this.id === null)
      this.id = this.blocker.start("prevent-app-suspension");
    else if (!want && this.id !== null) {
      this.blocker.stop(this.id);
      this.id = null;
    }
    return this.id !== null;
  }
  close() {
    if (this.id !== null) this.blocker.stop(this.id);
    this.id = null;
  }
}
