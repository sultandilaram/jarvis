// Offline voice fixture. Never creates a microphone track or OpenAI connection.
export class Voice {
  closed = true;
  state = "off";
  muted = false;
  constructor(
    public update: any,
    public fail: any,
    public diagnostic: any,
    public bridge: any,
  ) {
    (window as any).__previewVoice = this;
  }
  observe() {}
  context() {}
  setMuted(value: boolean) {
    this.muted = value;
  }
  async connect() {
    this.disconnect();
    this.closed = false;
    this.update("connecting");
    await this.bridge.voiceActivity(true);
    this.state = "listening";
    this.update("listening", "How may I help?");
  }
  disconnect() {
    const active = !this.closed;
    this.closed = true;
    this.state = "off";
    this.update("off");
    if (active) void this.bridge.voiceActivity(false);
  }
}
