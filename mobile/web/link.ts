import {
  parsePairQR,
  pairKeys,
  derivePairKey,
  comparisonCode,
  seal,
  unseal,
  type PairQR,
} from "../../src/shared/link-crypto.ts";
export type Pairing = { id: string; key: string; url: string; name: string };
export class MobileLink {
  socket?: WebSocket;
  pair?: Pairing;
  challenge = "";
  connected = false;
  pending = new Map<
    string,
    {
      resolve: (x: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  onState: () => void = () => {};
  onEvent: (e: any) => void = () => {};
  onPaired: (p: Pairing) => void = () => {};
  onError: (e: string) => void = () => {};
  code = "";
  pairingName = "";
  generation = 0;
  connecting = false;
  private reconnect = false;
  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  async scan(raw: string) {
    const qr = parsePairQR(raw);
    this.disconnect();
    this.connecting = true;
    const generation = this.generation;
    this.onState();
    const pair = await pairKeys();
    const key = await derivePairKey(pair.privateKey, qr.publicKey, qr.ticket);
    if (generation !== this.generation) return;
    this.code = await comparisonCode(key);
    this.pairingName = qr.desktop;
    this.onState();
    const socket = (this.socket = new WebSocket(
      qr.url.replace(/^https:/, "wss:") + "link",
    ));
    socket.onopen = () => {};
    socket.onmessage = async (e) => {
      if (this.socket !== socket || generation !== this.generation) return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === "hello") {
          socket.send(
            JSON.stringify({
              type: "pair",
              ticket: qr.ticket,
              publicKey: pair.publicKey,
              box: await seal(
                key,
                { name: "JARVIS Android", challenge: m.challenge },
                "pair",
              ),
            }),
          );
        }
        if (m.type === "pair-pending") {
          const data = await unseal(key, m.box, "mac->phone");
          if (data.code !== this.code) throw Error("Pairing comparison failed");
        }
        if (m.type === "paired") {
          const data = await unseal(key, m.box, "mac->phone");
          if (this.socket !== socket || generation !== this.generation) return;
          const value = { id: data.id, name: qr.desktop, url: qr.url, key };
          this.pair = value;
          this.code = "";
          this.connecting = false;
          this.onPaired(value);
          socket.onclose = null;
          socket.close();
          void this.connect(value);
        }
      } catch (e) {
        this.onError(String(e));
        socket.close();
      }
    };
    socket.onerror = () =>
      this.onError(
        "Cannot reach the Mac. Check its mobile link and scan a fresh QR.",
      );
    socket.onclose = () => {
      this.connecting = false;
      this.onState();
    };
  }
  async connect(pair: Pairing, retry = false) {
    this.disconnect();
    this.reconnect = true;
    if (!retry) this.retries = 0;
    const generation = this.generation;
    this.pair = pair;
    this.connecting = true;
    this.onState();
    const socket = (this.socket = new WebSocket(
      pair.url.replace(/^https:/, "wss:") + "link",
    ));
    socket.onmessage = async (e) => {
      if (this.socket !== socket || generation !== this.generation) return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === "hello") {
          this.challenge = m.challenge;
          socket.send(
            JSON.stringify({
              type: "auth",
              deviceId: pair.id,
              box: await seal(pair.key, { challenge: m.challenge }, "auth"),
            }),
          );
          return;
        }
        if (m.type === "ready") {
          const proof = await unseal(pair.key, m.box, "mac->phone");
          if (proof.id !== pair.id) throw Error("Desktop identity mismatch");
          if (this.socket !== socket || generation !== this.generation) return;
          this.connected = true;
          this.retries = 0;
          this.connecting = false;
          this.onState();
          return;
        }
        if (m.type === "packet") {
          const result = await unseal(pair.key, m.box, "mac->phone");
          if (this.socket !== socket || generation !== this.generation) return;
          const pending = this.pending.get(result.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(result.id);
            result.ok
              ? pending.resolve(result.value)
              : pending.reject(Error(result.error || "Request failed"));
          }
        }
        if (m.type === "event") {
          const event = await unseal(pair.key, m.box, "mac->phone");
          if (this.socket === socket && generation === this.generation)
            this.onEvent(event);
        }
      } catch (e) {
        this.onError(String(e));
        socket.close();
      }
    };
    socket.onerror = () =>
      this.onError(
        "Desktop link unavailable. Reconnecting automatically. Keep the Mac awake and online.",
      );
    socket.onclose = (event) => {
      if (this.socket !== socket || generation !== this.generation) return;
      this.connected = false;
      this.connecting = false;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          Error(
            "Desktop link disconnected; task outcomes must be checked before retrying.",
          ),
        );
      }
      this.pending.clear();
      this.onState();
      this.onEvent({ type: "disconnected" });
      if (event.code === 1008) {
        this.reconnect = false;
        this.onError(
          "Your pairing was rejected or revoked. Pair with this Mac again.",
        );
        return;
      }
      if (this.reconnect) {
        const delay =
          Math.min(15000, 500 * 2 ** Math.min(this.retries++, 5)) +
          Math.random() * 250;
        this.retryTimer = setTimeout(() => {
          if (this.reconnect && generation === this.generation)
            void this.connect(pair, true);
        }, delay);
      }
    };
  }
  async rpc(method: string, params?: unknown) {
    if (!this.connected || !this.socket || !this.pair)
      throw Error("Connect to your paired desktop first.");
    const id = crypto.randomUUID();
    const socket = this.socket;
    const generation = this.generation;
    const request = {
      id,
      at: Date.now(),
      challenge: this.challenge,
      method,
      params,
    };
    const box = await seal(this.pair.key, request, "phone->mac");
    if (this.socket !== socket || generation !== this.generation || !this.connected)
      throw Error("Desktop link changed before the request was sent. Check its state before retrying.");
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Error(
            "Desktop request timed out. Inspect the outcome before retrying.",
          ),
        );
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: "packet", box }));
    });
  }
  disconnect() {
    this.reconnect = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    this.connected = false;
    this.connecting = false;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Disconnected"));
    }
    this.pending.clear();
  }
}
