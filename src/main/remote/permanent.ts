export const permanentPort = 47832;
export type PermanentTunnel = {
  url: string;
  token: string;
  autoStart: boolean;
  port: number;
};
export function permanentTunnel(input: unknown): PermanentTunnel {
  const value = input as Partial<PermanentTunnel>;
  if (
    !value ||
    typeof value.url !== "string" ||
    typeof value.token !== "string"
  )
    throw Error("Enter the permanent HTTPS address and connector token.");
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw Error("Enter a valid HTTPS address.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !/^[a-z0-9.-]+$/.test(url.hostname) ||
    !url.hostname.includes(".") ||
    /^(?:[0-9.]+)$/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|trycloudflare\.com)$/.test(url.hostname)
  )
    throw Error(
      "Use your permanent public HTTPS hostname, without a path or temporary tunnel address.",
    );
  const entered = value.token.trim();
  const token = entered.match(/\beyJ[a-zA-Z0-9_+/=-]{40,8192}/)?.[0] || entered;
  if (!/^[a-zA-Z0-9_+/=-]{40,8192}$/.test(token))
    throw Error(
      "Paste the tunnel connector token or its copied install command, not an account API key.",
    );
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    if (
      typeof decoded.a !== "string" ||
      !/^[a-f0-9]{32}$/i.test(decoded.a) ||
      typeof decoded.t !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(decoded.t) ||
      typeof decoded.s !== "string" ||
      !decoded.s
    )
      throw Error();
  } catch {
    throw Error("This is not a Cloudflare tunnel connector token.");
  }
  return {
    url: url.origin,
    token,
    autoStart: value.autoStart !== false,
    port: permanentPort,
  };
}
