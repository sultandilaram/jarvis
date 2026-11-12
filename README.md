# JARVIS

A local-first, voice-centered personal desktop agent with an Android companion.
Codex performs task reasoning; JARVIS provides persistent jobs, controlled desktop
and browser tools, isolated project workspaces, approvals and phone coordination.

**Status: experimental macOS Apple Silicon / Android test release.** Local self-maintenance and signed update support are implemented in 0.6.0;
unattended GitHub maintenance requires separate configured GitHub Apps and branch
protections. Public release infrastructure is still being commissioned.
This independent project is not affiliated with Marvel or OpenAI.

## Capabilities

- Local “Hey JARVIS” detection; no cloud voice session while in local standby.
- Voice interaction, corrections, explicit consequential-action approvals and Stop.
- Durable jobs, scheduled starts, checkpoints, recovery and bounded execution.
- Isolated project coding with approved commands and optional filtered public HTTPS.
- Granted-file and public-page monitors that queue follow-up jobs.
- QR-paired Android voice, incoming calls and Mac-first task notifications.

The Mac must remain logged in, awake, online and running JARVIS. Browser research
uses JARVIS's controlled browser. Email/calendar services are not preconfigured.

## Development

Requires macOS, Node.js 24+, npm and an authenticated compatible Codex backend.
Discovery uses JARVIS_CODEX_PATH, the supported installed app path, then codex on
PATH. Installing a desktop app alone does not guarantee backend compatibility.

```sh
npm ci
npm run typecheck
npm test
npm start
```

For packaged local builds, run `npm run setup:wake`, `npm run setup:remote`, then
follow MACOS-LOCAL-RELEASE.md. `npm run package:local` requires your own persistent
local signing identity. Never use or request another user's private signing key.
Android build tools are configured using `npm run setup:android`; inspect its
license/download steps before running. `npm run build:mobile` uses the local SDK
configuration and persistent test signing key. Public release signing is a
separate setup; do not regenerate the signing key between shared APK versions.

Voice currently needs an OpenAI project API key and voice access. Task reasoning
uses the user's Codex sign-in. Microphone/Accessibility permission and folder
grants are per installation. Phone remote access needs a tunnel; locked-phone
alerts need Firebase configuration. No credentials, hosted relay or push authority
are included. Ordinary desktop/text use does not require those optional services.

## Data and controls

Local history, job state and memories are stored in SQLite under the application's
user data directory. Credentials use the local credential vault/Keychain setup.
History is not encrypted by the application. The renderer has no Node access.
Model instructions cannot replace actual approval enforcement.

Say **Stop** to pause current work and end voice. **Stop all work** also pauses the
queue and monitors. Ending voice alone leaves background jobs running. Interrupted
jobs require explicit safe resume; effects already performed cannot be undone.

## Contributions and distribution

Read SECURITY.md, SELF-MANAGEMENT.md and docs/MAINTENANCE.md. Sensitive changes
require owner review; external PR checks run without release secrets. Native/UI
and physical-device checks may be needed beyond the unit suite. A GitHub release
or a model statement alone is not proof of an authenticated safe update.

The source is Apache-2.0; third-party notices and assets have separate provenance
requirements in NOTICE. Public notarized distribution remains unfinished. The updater requires signed
release metadata and user approval; it does not install arbitrary GitHub uploads. Do not treat the present owner-signed test build as a notarized
public distribution.

## Self-improvement

Ask “Improve JARVIS…” to create a source proposal. JARVIS codes in a disposable
project, freezes its changes, then queues an independent reviewer. Required checks
are tied to the exact snapshot. Ordinary documentation may merge locally after
review; code, UI and policy changes require owner approval. Inspect source and
update state in Settings. A source merge does not change the running application.

For the upstream maintainer, GitHub publication additionally requires two separately
registered GitHub App identities (proposer/reviewer), installed only for jarvis and
imported locally via Settings. The Codex connector is not their credential source.
No maintainer credentials are needed for normal users consuming public updates.

For the upstream maintainer, Settings can configure private build state for local
owner-approved signing builds. repo.release requests a checked source tag;
repo.build_release requests a separate build/publication approval. This is privileged
reviewed-source execution. Signing state stays on the maintainer Mac; no public
self-hosted runner is needed. Consuming an update remains a separate user decision.
