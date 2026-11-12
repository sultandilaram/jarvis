# Source preparation verification — 2026-11-12

The allowlisted public source exported independently of private .jarvis/Workspace
state. In that export, npm ci, both TypeScript projects, all 82 tests, npm run build
and the source audit passed. No real voice session, phone call or owner task was
started. Hosted GitHub CI has not run yet; GitHub authentication is pending.

The DMG contains the existing locally signed 0.5.0 application and was verified by
hdiutil. It is not notarized and does not add an updater or repository tools to
the installed app. Existing Android 0.5.0 is unchanged.

npm audit reports five moderate advisories in the development packaging chain
(@electron/packager, @electron/asar, @electron/universal, glob and minimatch).
The suggested top-level remediation includes a major downgrade of packager;
no automatic audit fix was applied. Resolve and revalidate packaging before a
stable public release. The source audit is a bounded credential-pattern and
allowlist check, not an independent exhaustive security audit.

0.6.0 adds tested local maintenance/review gates and signed-update verification.
The real Codex disposable maintenance acceptance passed separate proposer/reviewer
jobs, three actual command receipts and a recorded ordinary local merge. GitHub
App authorization remains to be provisioned and tested live.
