const enc = new TextEncoder();
export function base64(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function unbase64(s: string) {
  if (typeof s !== "string" || s.length > 1500000)
    throw Error("Invalid encoded data");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export function randomSecret() {
  return base64(crypto.getRandomValues(new Uint8Array(32)));
}
export async function pairKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateKey: pair.privateKey,
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}
export async function derivePairKey(
  privateKey: CryptoKey,
  publicKey: JsonWebKey,
  ticket: string,
) {
  const pub = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub },
    privateKey,
    256,
  );
  const seed = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveBits",
  ]);
  return base64(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: unbase64(ticket),
          info: enc.encode("JARVIS private link v1"),
        },
        seed,
        256,
      ),
    ),
  );
}
export async function comparisonCode(key: string) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", unbase64(key)),
  );
  return String(new DataView(hash.buffer).getUint32(0) % 1000000).padStart(
    6,
    "0",
  );
}
export async function seal(key: string, value: unknown, direction: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey(
    "raw",
    unbase64(key),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(direction) },
    k,
    enc.encode(JSON.stringify(value)),
  );
  return { iv: base64(iv), data: base64(new Uint8Array(data)) };
}
export async function unseal(
  key: string,
  box: { iv: string; data: string },
  direction: string,
) {
  const iv = unbase64(box.iv);
  if (iv.length !== 12) throw Error("Invalid nonce");
  const k = await crypto.subtle.importKey(
    "raw",
    unbase64(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(direction) },
    k,
    unbase64(box.data),
  );
  return JSON.parse(new TextDecoder().decode(data));
}
export type PairQR = {
  v: 1;
  url: string;
  ticket: string;
  publicKey: JsonWebKey;
  expires: number;
  desktop: string;
};
export function parsePairQR(value: string): PairQR {
  const q = JSON.parse(value);
  const u = new URL(q.url);
  if (
    q.v !== 1 ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    !q.publicKey ||
    unbase64(q.ticket).length !== 32 ||
    !Number.isFinite(q.expires) ||
    q.expires < Date.now() ||
    q.expires > Date.now() + 180000
  )
    throw Error(
      "Expired or invalid JARVIS pairing QR. Generate a fresh code on the Mac.",
    );
  return q;
}
