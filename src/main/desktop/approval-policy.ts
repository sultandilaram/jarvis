export type ApprovalMode = "always" | "critical";
// Classifications come from trusted planners, never model-supplied tool arguments.
export type RoutineAction =
  "open-app" | "browse" | "new-draft" | "sandbox" | "view";
const routineActions: Readonly<Record<string, RoutineAction>> = Object.freeze({
  "apps.open": "open-app",
  "browser.open": "browse",
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
      !/(?:^|[^a-z])(auth|oauth|authorize|callback|login|logout|signin|signout|unsubscribe|subscribe|confirm|approve|accept|reject|delete|remove|reset|revoke|send|submit|pay|purchase|checkout|transfer|invite|join|redeem|activate|install|execute)(?:[^a-z]|$)/i.test(
        path,
      )
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
