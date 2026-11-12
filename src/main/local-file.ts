import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function readSelectedFile(path: string) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Choose a regular text file.");
    if (stat.size > 1024 * 1024)
      throw new Error("This milestone supports text files up to 1 MiB.");
    const data = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead !== stat.size)
      throw new Error("The file changed while reading. Choose it again.");
    const content = data.subarray(0, bytesRead);
    if (content.includes(0))
      throw new Error(
        "This appears to be a binary file. Choose a UTF-8 text file.",
      );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return {
      path,
      bytes: bytesRead,
      sha256: createHash("sha256").update(content).digest("hex"),
      text,
    };
  } finally {
    await file.close();
  }
}
