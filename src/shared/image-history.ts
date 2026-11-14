const omitted =
  "[Inline image omitted from JARVIS history; capture again if needed.]";
const inlineURL = (v: unknown) =>
  typeof v === "string" && /^data:image\/(?:jpeg|png);base64,/.test(v);
const imageBytes = (v: unknown) =>
  typeof v === "string" &&
  /^(?:iVBORw0KGgo|\/9j\/)/.test(v) &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(v);
// Remove actual image payloads, not unrelated plugin fields with the same names.
// This controls JARVIS records, not a selected provider's own retention policy.
export function withoutInlineImages<T>(value: T): T {
  const walk = (v: any, depth: number): any => {
    if (depth > 30) return "[Deep history structure omitted]";
    if (typeof v === "string")
      return imageBytes(v)
        ? omitted
        : v.replace(
            /data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+/g,
            omitted,
          );
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (!v || typeof v !== "object") return v;
    if (
      (v.type === "image" &&
        v.source?.type === "base64" &&
        imageBytes(v.source.data)) ||
      (v.type === "image_url" && inlineURL(v.image_url?.url))
    )
      return { type: "text", text: omitted };
    if (imageBytes(v.inlineData?.data)) return { text: omitted };
    const ollamaImage =
      v.role === "user" &&
      typeof v.content === "string" &&
      Array.isArray(v.images) &&
      v.images.length > 0 &&
      v.images.every(imageBytes);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(v)) {
      if (key === "images" && ollamaImage) continue;
      Object.defineProperty(out, key, {
        value: walk(item, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    if (ollamaImage) out.content = v.content + "\n" + omitted;
    return out;
  };
  return walk(value, 0);
}
