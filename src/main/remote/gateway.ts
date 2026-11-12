import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import {
  pairKeys,
  derivePairKey,
  comparisonCode,
  randomSecret,
  seal,
  unseal,
  type PairQR,
} from "../../shared/link-crypto.ts";
export type Phone = {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  pushToken?: string;
};
export type RemoteRPC = (
  method: string,
  params: any,
  phone: Phone,
) => Promise<unknown>;
export class PhoneGateway extends EventEmitter {
  server?: Server;
  readonly instanceId = crypto.randomUUID();
  wss?: WebSocketServer;
  url = "";
  phones: Phone[] = [];
  clients = new Map<string, WebSocket>();
  pairing?: { qr: PairQR; privateKey: CryptoKey };
  pending?: {
    id: string;
    name: string;
    code: string;
    key: string;
    socket: WebSocket;
    expires: number;
  };
  responseCache = new Map<string, { at: number; result: Promise<unknown> }>();
  constructor(
    public rpc: RemoteRPC,
    public save: (phones: Phone[]) => Promise<void>,
    public androidApk?: string,
  ) {
    super();
  }
  snapshot() {
    return {
      running: !!this.server,
      url: this.url,
      phones: this.phones.map(({ id, name, createdAt, pushToken }) => ({
        id,
        name,
        createdAt,
        online: this.clients.has(id),
        alertsEnabled: !!pushToken,
      })),
      pending: this.pending
        ? {
            id: this.pending.id,
            name: this.pending.name,
            code: this.pending.code,
            expires: this.pending.expires,
          }
        : null,
    };
  }
  async start(port = 0) {
    if (this.server) return (this.server.address() as any).port;
    this.server = createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            service: "jarvis-link",
            version: 1,
            instance: this.instanceId,
          }),
        );
      } else if (
        req.method === "GET" &&
        req.url === "/android.apk" &&
        this.androidApk &&
        existsSync(this.androidApk)
      ) {
        res.writeHead(200, {
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": "attachment; filename=JARVIS-Android-test.apk",
          "Content-Length": statSync(this.androidApk).size,
        });
        const file = createReadStream(this.androidApk);
        file.on("error", () => res.destroy());
        file.pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    });
    this.server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/link" || this.wss!.clients.size >= 12) {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => this.connection(ws));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(port, "127.0.0.1", resolve);
      });
    } catch (error) {
      this.close();
      throw error;
    }
    return (this.server.address() as any).port;
  }
  async createQR(url: string) {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw Error("A public HTTPS root URL is required.");
    this.url = u.origin;
    this.pending?.socket.close(1008, "New pairing code");
    this.pending = undefined;
    const pair = await pairKeys();
    const qr: PairQR = {
      v: 1,
      url: u.origin + "/",
      ticket: randomSecret(),
      publicKey: pair.publicKey,
      expires: Date.now() + 120000,
      desktop: "JARVIS on Mac",
    };
    this.pairing = { qr, privateKey: pair.privateKey };
    this.emit("state");
    return qr;
  }
  connection(ws: WebSocket) {
    const challenge = randomSecret();
    let phone: Phone | undefined;
    let busy = false;
    let count = 0,
      windowAt = Date.now();
    const timeout = setTimeout(() => {
      if (!phone && this.pending?.socket !== ws)
        ws.close(1008, "Authentication timeout");
    }, 15000);
    timeout.unref();
    ws.send(JSON.stringify({ type: "hello", challenge }));
    ws.on("message", async (raw) => {
      try {
        if (Date.now() - windowAt > 1000) {
          count = 0;
          windowAt = Date.now();
        }
        if (++count > 20) throw Error("Rate limit exceeded");
        const message = JSON.parse(String(raw));
        if (!phone) {
          if (busy) throw Error("Pairing or authentication already pending");
          busy = true;
          if (message.type === "pair") {
            const p = this.pairing;
            if (
              !p ||
              p.qr.expires < Date.now() ||
              message.ticket !== p.qr.ticket ||
              this.pending
            )
              throw Error("Pairing code expired or in use");
            const key = await derivePairKey(
              p.privateKey,
              message.publicKey,
              p.qr.ticket,
            );
            const request = await unseal(key, message.box, "pair");
            if (
              request.challenge !== challenge ||
              typeof request.name !== "string" ||
              request.name.length > 60
            )
              throw Error("Invalid pairing request");
            const id = crypto.randomUUID();
            this.pending = {
              id,
              name: request.name.trim() || "Android phone",
              code: await comparisonCode(key),
              key,
              socket: ws,
              expires: p.qr.expires,
            };
            ws.send(
              JSON.stringify({
                type: "pair-pending",
                box: await seal(key, { code: this.pending.code }, "mac->phone"),
              }),
            );
            this.emit("state");
            return;
          }
          if (message.type !== "auth" || typeof message.deviceId !== "string")
            throw Error("Authentication required");
          const stored = this.phones.find((p) => p.id === message.deviceId);
          if (!stored) throw Error("Unknown or revoked phone");
          const proof = await unseal(stored.key, message.box, "auth");
          if (proof.challenge !== challenge) throw Error("Invalid challenge");
          phone = stored;
          this.clients.get(phone.id)?.close(1000, "Reconnected");
          this.clients.set(phone.id, ws);
          clearTimeout(timeout);
          ws.send(
            JSON.stringify({
              type: "ready",
              box: await seal(
                phone.key,
                { id: phone.id, name: phone.name },
                "mac->phone",
              ),
            }),
          );
          this.emit("state");
          return;
        }
        if (message.type !== "packet") throw Error("Encrypted packet required");
        const request = await unseal(phone.key, message.box, "phone->mac");
        if (this.clients.get(phone.id) !== ws || !this.phones.includes(phone))
          throw Error("Phone access expired");
        if (
          request.challenge !== challenge ||
          typeof request.id !== "string" ||
          request.id.length > 80 ||
          typeof request.method !== "string" ||
          !Number.isFinite(request.at) ||
          Math.abs(Date.now() - request.at) > 120000
        )
          throw Error("Invalid or stale request");
        for (const [id, r] of this.responseCache)
          if (Date.now() - r.at > 300000) this.responseCache.delete(id);
        const cacheId = phone.id + ":" + request.id;
        let cached = this.responseCache.get(cacheId);
        if (!cached) {
          if (this.responseCache.size > 1000) throw Error("Too many requests");
          cached = {
            at: Date.now(),
            result: Promise.resolve()
              .then(() => {
                if (!this.phones.includes(phone!))
                  throw Error("Phone access revoked");
                return this.rpc(request.method, request.params, phone!);
              })
              .then(
                (value) => ({ ok: true, value }),
                (e) => ({
                  ok: false,
                  error: e instanceof Error ? e.message : String(e),
                }),
              ),
          };
          this.responseCache.set(cacheId, cached);
        }
        const result = await cached.result;
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              type: "packet",
              box: await seal(
                phone.key,
                { id: request.id, ...(result as any) },
                "mac->phone",
              ),
            }),
          );
      } catch {
        ws.close(1008, "Request rejected");
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(timeout);
      if (phone && this.clients.get(phone.id) === ws) {
        this.clients.delete(phone.id);
        this.emit("disconnect", phone.id);
      }
      if (this.pending?.socket === ws) this.pending = undefined;
      this.emit("state");
    });
  }
  async decide(id: string, accepted: boolean) {
    const p = this.pending;
    if (
      !p ||
      p.id !== id ||
      p.expires < Date.now() ||
      p.socket.readyState !== WebSocket.OPEN
    )
      throw Error("Pairing request expired");
    this.pending = undefined;
    this.pairing = undefined;
    if (!accepted) {
      p.socket.close(1008, "Pairing declined");
      this.emit("state");
      return;
    }
    const phone: Phone = {
      id: p.id,
      name: p.name,
      key: p.key,
      createdAt: new Date().toISOString(),
    };
    const next = [...this.phones, phone];
    if (next.length > 8) throw Error("Revoke a phone before adding another");
    await this.save(next);
    this.phones = next;
    p.socket.send(
      JSON.stringify({
        type: "paired",
        box: await seal(
          p.key,
          { id: phone.id, name: phone.name },
          "mac->phone",
        ),
      }),
    );
    p.socket.close(1000, "Pairing complete; reconnect");
    this.emit("state");
  }
  async revoke(id: string) {
    const next = this.phones.filter((p) => p.id !== id);
    await this.save(next);
    this.phones = next;
    this.clients.get(id)?.close(1008, "Access revoked");
    this.clients.delete(id);
    this.emit("state");
  }
  async push(value: unknown, recipients?: string[]) {
    await Promise.all(
      [...this.clients].map(async ([id, ws]) => {
        if (recipients && !recipients.includes(id)) return;
        const p = this.phones.find((p) => p.id === id);
        if (p && ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              type: "event",
              box: await seal(p.key, value, "mac->phone"),
            }),
          );
      }),
    );
  }
  close() {
    this.pending = undefined;
    this.pairing = undefined;
    for (const ws of this.wss?.clients || [])
      ws.close(1001, "Desktop link disabled");
    this.wss?.close();
    this.server?.close();
    this.wss = undefined;
    this.server = undefined;
    this.url = "";
    this.clients.clear();
    this.emit("state");
  }
}
