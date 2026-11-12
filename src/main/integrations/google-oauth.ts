import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export type GoogleService = "gmail" | "calendar";
export type GoogleClient = { clientId: string; clientSecret?: string };
export const scopesFor = (service: GoogleService, write: boolean) => [
  "openid",
  "email",
  ...(service === "gmail"
    ? [
        "https://www.googleapis.com/auth/gmail.readonly",
        ...(write ? ["https://www.googleapis.com/auth/gmail.send"] : []),
      ]
    : [
        "https://www.googleapis.com/auth/calendar.events" +
          (write ? "" : ".readonly"),
      ]),
];
export function parseGoogleClient(value: unknown): GoogleClient {
  const v = (value as any)?.installed;
  if (
    !v ||
    typeof v.client_id !== "string" ||
    !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(v.client_id) ||
    (v.client_secret !== undefined &&
      (typeof v.client_secret !== "string" ||
        v.client_secret.length < 8 ||
        v.client_secret.length > 300))
  )
    throw Error(
      "Choose Google's OAuth client JSON for a Desktop app, not a service-account or web client.",
    );
  return {
    clientId: v.client_id,
    ...(v.client_secret === undefined ? {} : { clientSecret: v.client_secret }),
  };
}
export async function googleJSON(
  request: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
  } catch {
    signal.throwIfAborted();
    throw Error(
      "Google could not be reached. Check your connection; a submitted action may need verification before retrying.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 400 && url === "https://oauth2.googleapis.com/token"
        ? "Google authorization was rejected. Reconnect the account; check the OAuth client and Google consent configuration."
        : response.status === 401
          ? "Google sign-in expired. Reconnect this account."
          : response.status === 403
            ? "Google denied access. Check the granted permissions and enable this API in your Google Cloud project."
            : `Google returned HTTP ${response.status}. Verify any submitted action before retrying.`,
    );
  }
  if (!response.body) throw Error("Google returned an empty response.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 2 * 1024 * 1024)
        throw Error("Google response exceeds the 2 MiB limit.");
      parts.push(p.value);
    }
    const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Google returned an invalid response.");
    return value;
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e instanceof SyntaxError
      ? Error("Google returned an invalid response.")
      : e;
  }
}
export async function authorizeGoogle(
  client: GoogleClient,
  scopes: string[],
  open: (url: string) => Promise<void>,
  signal: AbortSignal,
) {
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  let finish!: (code: string) => void, fail!: (e: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Attach a rejection handler before any awaited browser/listen operation.
  void code.catch(() => {});
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    // Redirects from the browser use origin-form request targets. Reject proxy-
    // style or malformed targets without letting URL parsing crash the app.
    const target = req.url || "/";
    if (!target.startsWith("/") || target.startsWith("//")) {
      res.writeHead(400).end("Invalid sign-in response. Return to JARVIS.");
      return;
    }
    let url: URL;
    try {
      url = new URL(target, `http://${authority}`);
    } catch {
      res.writeHead(400).end("Invalid sign-in response. Return to JARVIS.");
      return;
    }
    const received = url.searchParams.get("state") || "";
    if (
      req.method !== "GET" ||
      req.headers.host !== authority ||
      url.pathname !== "/oauth/callback" ||
      Buffer.byteLength(received) !== Buffer.byteLength(state) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(state))
    ) {
      res.writeHead(400).end("Invalid sign-in response. Return to JARVIS.");
      return;
    }
    const c = url.searchParams.get("code");
    if (url.searchParams.has("error") || !c || c.length > 4096) {
      res.writeHead(400).end("Sign-in was not completed. Return to JARVIS.");
      fail(Error("Google sign-in was cancelled or denied."));
    } else {
      res.end("Sign-in received. You can close this tab and return to JARVIS.");
      finish(c);
    }
  });
  let authority = "";
  const abort = () => fail(Error("Google sign-in cancelled."));
  const timer = setTimeout(
    () => fail(Error("Google sign-in timed out. Try connecting again.")),
    180000,
  );
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Could not start local sign-in callback.");
    authority = `127.0.0.1:${address.port}`;
    const redirect = `http://${authority}/oauth/callback`;
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: scopes.join(" "),
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "false",
    }).toString();
    await open(auth.href);
    const result = await code;
    signal.throwIfAborted();
    return { code: result, redirect, verifier };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections();
  }
}
