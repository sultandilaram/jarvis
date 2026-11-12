import { createServer, connect, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { publicAddress } from "./monitors.ts";
// Short-lived HTTPS CONNECT proxy. The command sandbox can reach only this port;
// the supervisor resolves/pins public addresses and never forwards local/private traffic.
export async function projectNetwork() {
  const sockets = new Set<Socket>();
  let bytes = 0;
  const cap = 50 * 1024 * 1024;
  const server = createServer((socket) => {
    if (sockets.size >= 12) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(120000, () => socket.destroy());
    let header = Buffer.alloc(0);
    const receive = async (chunk: Buffer) => {
      header = Buffer.concat([header, chunk]);
      if (header.length > 16384) {
        socket.destroy();
        return;
      }
      const end = header.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.removeListener("data", receive);
      socket.pause();
      try {
        const line = header.toString("ascii", 0, end).split("\r\n")[0];
        const match = /^CONNECT ([A-Za-z0-9.-]+):443 HTTP\/1\.[01]$/.exec(line);
        if (!match) throw Error("Only public HTTPS CONNECT is supported.");
        const all = await lookup(match[1], { all: true });
        if (!all.length || all.some((a) => !publicAddress(a.address)))
          throw Error("Private destination denied.");
        if (socket.destroyed) return;
        const upstream = connect({
          host: all[0].address,
          port: 443,
          family: all[0].family,
        });
        sockets.add(upstream);
        upstream.on("close", () => sockets.delete(upstream));
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
        upstream.setTimeout(15000, () => upstream.destroy());
        const count = (data: Buffer) => {
          bytes += data.length;
          if (bytes > cap) for (const s of sockets) s.destroy();
        };
        upstream.on("data", count);
        socket.on("data", count);
        upstream.once("connect", () => {
          if (socket.destroyed) {
            upstream.destroy();
            return;
          }
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          const pending = header.subarray(end + 4);
          if (pending.length) upstream.write(pending);
          socket.pipe(upstream);
          upstream.pipe(socket);
          socket.resume();
        });
      } catch {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      }
    };
    socket.on("data", receive);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as any).port as number;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}
