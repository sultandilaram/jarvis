export type ApprovalMode = "always" | "critical";
// Classifications come from trusted planners, never model-supplied tool arguments.
export type RoutineAction =
  "open-app" | "browse" | "new-draft" | "sandbox" | "view";
const routineActions: Readonly<Record<string, RoutineAction>> = Object.freeze({
  "apps.open": "open-app",
  "browser.open": "browse",
  "browser.search": "browse",
  "browser.follow": "browse",
  "browser.open_external": "browse",
  "files.write": "new-draft",
  "project.import": "sandbox",
  "project.exec": "sandbox",
  "desktop.scroll_to": "view",
});
export function isAutomatic(
  action: string,
  routine: RoutineAction | undefined,
  mode: unknown,
) {
  return (
    mode === "critical" &&
    routine !== undefined &&
    Object.hasOwn(routineActions, action) &&
    routineActions[action] === routine
  );
}
export const routineApps = new Set([
  "company.thebrowser.Browser",
  "com.apple.Safari",
  "com.google.Chrome",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "com.apple.TextEdit",
  "com.apple.finder",
  "com.apple.Preview",
  "com.apple.calculator",
  "net.whatsapp.WhatsApp",
]);
const consequentialURLSegment =
  /(?:^|[^a-z])(auth|oauth|authorize|callback|login|logout|signin|signout|unsubscribe|subscribe|confirm|approve|accept|reject|delete|remove|reset|revoke|send|submit|pay|purchase|checkout|transfer|invite|join|redeem|activate|install|execute)(?:[^a-z]|$)/i;
// Conservative browsing: account actions, opaque query links and local HTML need review.
// A URL is not a guarantee of harmless server behaviour; never classify a click by its label.
export function routineNavigation(raw: string) {
  try {
    const u = new URL(raw);
    const path = decodeURIComponent(u.pathname);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      !u.port &&
      !/^(localhost|.*\.localhost|.*\.local|[\d.]+|\[.*\])$/i.test(
        u.hostname,
      ) &&
      !consequentialURLSegment.test(path)
    );
  } catch {
    return false;
  }
}

// Only operator text received through the trusted UI/paired-phone channel may
// supply these targets. Tool arguments, retrieved documents and checkpoints cannot.
export function requestedNavigationTargets(operatorText: string): string[] {
  // A cited URL is data, not permission. Restrict this convenience to a leading,
  // explicit opening command; complex or negated requests keep exact review.
  if (
    /\b(?:not|don['’]?t|never|without|avoid|cancel|except|instead of|rather than)\b/i.test(
      operatorText,
    )
  )
    return [];
  const command =
    /^(?:(?:correction[:,]?|also)\s+)*(?:(?:please|can you|could you|would you)\s+)?(?:open|visit|browse(?: to)?|navigate to|go to)\s+/i.exec(
      operatorText.trim(),
    );
  if (!command) return [];
  const targets = new Set<string>();
  let expectingURL = true;
  for (let token of operatorText.trim().slice(command[0].length).split(/\s+/)) {
    if (!expectingURL) {
      if (token.toLowerCase() !== "and") return [];
      expectingURL = true;
      continue;
    }
    token = token.replace(/^[\s"'(<`]+|[\s"'>),;.!?`]+$/g, "");
    if (!/^https:\/\//i.test(token)) {
      if (
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s]*)?$/i.test(
          token,
        )
      )
        return [];
      token = "https://" + token;
    }
    if (!routineNavigation(token)) return [];
    targets.add(new URL(token).href);
    expectingURL = false;
  }
  return expectingURL ? [] : [...targets];
}
export function authorizedNavigation(raw: string, targets: readonly string[]) {
  if (!routineNavigation(raw)) return false;
  try {
    return targets.includes(new URL(raw).href);
  } catch {
    return false;
  }
}

// A search can send operator-supplied terms, never new text from a model,
// private file, account, page or checkpoint. Keep this separate from URL grants.
export function searchURL(query: unknown) {
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 1000 ||
    /[\x00-\x1f\x7f]/.test(query)
  )
    throw Error("Enter a search query of 1–1,000 characters.");
  const u = new URL("https://duckduckgo.com/");
  u.searchParams.set("q", query.trim());
  return u.href;
}
export function routineResearchNavigation(raw: string) {
  if (!routineNavigation(raw)) return false;
  try {
    const u = new URL(raw),
      path = decodeURIComponent(u.pathname);
    return (
      !path.includes("%") &&
      !/[a-z0-9_-]{32,}/i.test(u.hostname + "/" + path) &&
      !consequentialURLSegment.test(u.hostname + "/" + path) &&
      !/(?:^|[^a-z])(?:auth|accounts?|settings?|profiles?|portal|dashboard|admin|log[._-]?(?:in|out)|sign[._-]?(?:in|out)|users?|my|billing|payments?|password|credentials?|security|tokens?|keys?)(?:[^a-z]|$)/i.test(
        u.hostname + "/" + path,
      )
    );
  } catch {
    return false;
  }
}
export function researchQueryWithinRequest(
  query: unknown,
  operatorText: string,
) {
  try {
    const q = new URL(searchURL(query)).searchParams
      .get("q")!
      .normalize("NFKC")
      .toLocaleLowerCase();
    if (
      !operatorText ||
      // A recognized credential label anywhere in the operator context taints the whole
      // automatic vocabulary, including a query that omits the label itself.
      /pass|credential|secret|token|auth|bearer|session|sessid|cookie|signatur|signing|assertion|saml|csrf|xsrf|ticket|nonce|key|code|otp|recovery|seed|mnemonic|unlock|wallet|security|login|sign[\s_-]*in|connection|database[\s_-]*(?:url|uri)|\b(?:pins?|pwd|sids?|sigs?|jwts?|pem|dsns?|ssh|mfa|2fa|pat)\b/i.test(
        operatorText.normalize("NFKC"),
      ) ||
      /(?:\bsk[-_][\w-]{8,}|\b[A-Za-z0-9_-]{32,}\b|\b\d{9,}\b)/.test(q)
    )
      return false;
    const words = (s: string): string[] => s.match(/[\p{L}\p{N}_]+/gu) || [];
    const requested = new Set(
      words(operatorText.normalize("NFKC").toLocaleLowerCase()),
    );
    const allowed = new Set([
      ...requested,
      ...words(
        "official website documentation requirements comparison options information guide latest",
      ),
    ]);
    const terms = words(q);
    return (
      terms.length > 0 &&
      terms.some((t) => requested.has(t)) &&
      terms.every((t) => allowed.has(t)) &&
      /^[\p{L}\p{N}_\s.,:'"?!()+-]+$/u.test(q)
    );
  } catch {
    return false;
  }
}
