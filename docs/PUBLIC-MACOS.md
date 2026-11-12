# Local macOS builds

Public notarized distribution and the update service are not implemented yet.
Local source builds require macOS with Xcode command-line tools, Node.js 24+,
npm, the offline wake assets, and a compatible authenticated Codex installation.

```sh
npm ci
npm run setup:wake
npm run setup:remote
npm run setup:local-signing
npm run package:local
```

Inspect setup commands before running. The local-signing command creates a
persistent identity in your login Keychain and may require your approval there.
Keep that identity for subsequent builds. Do not commit or share its private key
or any .jarvis files. Packaging includes a fixed credential helper bound to that
identity. Changing its source/identity requires an explicit migration; do not
silently replace it on an existing installation.

Quit JARVIS, then `npm run install:local`. Initial Microphone and Accessibility
permissions are per Mac. Updating with the same identity is intended to preserve
them, but cannot promise macOS will never request permission again. New users
must never receive another user's local data, credentials, pairing or tunnel.

`node scripts/create-dmg.mjs` packages the existing verified local app. A DMG is
an installation container, not notarization or an authenticated update service.
The public release pipeline must choose stable signing/notarization and protect
release credentials separately from contributed code before broad distribution.
