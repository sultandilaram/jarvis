import { deflateSync } from "node:zlib";
import type { ProviderKind } from "./protocol.ts";
export function imageSource(url: string) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    url,
  );
  if (!match || match[2].length > 1400000)
    throw Error("Only bounded inline PNG/JPEG tool images are accepted.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2] || bytes.length > 1048576)
    throw Error("Invalid or oversized inline image.");
  return { mime: "image/" + match[1], data: match[2] };
}
export function imageMessage(kind: ProviderKind, text: string, urls: string[]) {
  const images = urls.map(imageSource);
  if (kind === "anthropic")
    return {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((i) => ({
          type: "image",
          source: { type: "base64", media_type: i.mime, data: i.data },
        })),
      ],
    };
  if (kind === "gemini")
    return {
      role: "user",
      parts: [
        { text },
        ...images.map((i) => ({
          inlineData: { mimeType: i.mime, data: i.data },
        })),
      ],
    };
  if (kind === "ollama")
    return { role: "user", content: text, images: images.map((i) => i.data) };
  return {
    role: "user",
    content: [
      { type: "text", text },
      ...urls.map((url) => ({ type: "image_url", image_url: { url } })),
    ],
  };
}
const digits = [
  "11111100011000110001100011000111111",
  "00100011000010000100001000010001110",
  "11111000010000111111100001000011111",
  "11111000010000111111000010000111111",
  "10001100011000111111000010000100001",
  "11111100001000011111000010000111111",
  "11111100001000011111100011000111111",
  "11111000010001000100010000100001000",
  "11111100011000111111100011000111111",
  "11111100011000111111000010000111111",
];
function crc(data: Buffer) {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const t = Buffer.from(type),
    length = Buffer.alloc(4),
    check = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  check.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([length, t, data, check]);
}
// A generated compatibility image, unrelated to any real window or user data.
export function visionProbeImage(nonce: string) {
  if (!/^\d{8}$/.test(nonce)) throw Error("Vision probe needs eight digits.");
  const width = 240,
    height = 64,
    raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  for (let n = 0; n < 8; n++)
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (digits[Number(nonce[n])][row * 5 + col] === "1")
          for (let dy = 0; dy < 4; dy++)
            for (let dx = 0; dx < 4; dx++) {
              const x = 12 + n * 27 + col * 4 + dx,
                y = 18 + row * 4 + dy,
                index = y * (width * 3 + 1) + 1 + x * 3;
              raw.fill(0, index, index + 3);
            }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}
