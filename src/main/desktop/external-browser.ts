import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { FileAccess } from "./files.ts";
import type { ActionPlan } from "./broker.ts";

export const externalBrowsers: Readonly<Record<string, string>> = Object.freeze({
  "company.thebrowser.Browser": "Arc",
  "com.apple.Safari": "Safari",
  "com.google.Chrome": "Google Chrome",
  "com.brave.Browser": "Brave",
  "com.microsoft.edgemac": "Microsoft Edge",
  "org.mozilla.firefox": "Firefox",
});

export async function planExternalBrowser(
  args: Record<string, unknown>,
  files: FileAccess,
  launch: (args: { bundleId: string; url: string }, signal: AbortSignal) => Promise<unknown>,
): Promise<ActionPlan> {
  const bundleId = args.bundleId;
  if (typeof bundleId !== "string" || !Object.hasOwn(externalBrowsers, bundleId))
    throw Error("Choose Arc, Safari, Chrome, Brave, Edge or Firefox by bundleId.");
  if ((args.url !== undefined) === (args.path !== undefined))
    throw Error("Provide exactly one HTTP(S) url or granted local HTML path.");
  let url: string;
  let verify: (() => Promise<void>) | undefined;
  let local: { path: string; sha256: string } | undefined;
  if (args.path !== undefined) {
    const path = await files.path(args.path);
    if (![".html", ".htm"].includes(extname(path).toLowerCase()))
      throw Error("External browser file opening supports HTML files only.");
    const before = await files.read(path);
    local = { path, sha256: before.sha256 };
    verify = async () => {
      const now = await files.read(await files.path(path));
      if (now.sha256 !== before.sha256 || now.identity !== before.identity)
        throw Error("The HTML file changed after preview. Request a new approval.");
    };
    url = pathToFileURL(path).href;
  } else {
    if (typeof args.url !== "string" || args.url.length > 8192 || /[\x00-\x20\x7f]/.test(args.url))
      throw Error("Provide an explicit HTTP(S) URL without whitespace or control characters.");
    const target = new URL(args.url);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
      throw Error("Only HTTP(S) URLs without embedded credentials are allowed; use path for local HTML.");
    url = target.href;
  }
  return {
    title: `Open in ${externalBrowsers[bundleId]}`,
    approval: true,
    preview: { browser: externalBrowsers[bundleId], bundleId, url, ...local,
      effect: "Open this target in the selected installed browser and its existing profile. Local HTML can run scripts and contact websites. This does not grant DOM control or prove the page loaded." },
    verify,
    run: async (signal) => {
      signal.throwIfAborted();
      await verify?.();
      signal.throwIfAborted();
      return launch({ bundleId, url }, signal);
    },
  };
}
