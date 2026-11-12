# Repository maintenance policy

Repository: sultandilaram/jarvis. Owner-selected policy: JARVIS may merge ordinary
changes after required checks and separate-context review. Sensitive changes
require Sultan's review. Apache-2.0 is the selected source license.

Configure the main branch ruleset on GitHub before enabling the maintainer:
- Require pull requests, at least one approval, code-owner approval, dismissal
  of stale approvals, and approval after the latest reviewable push.
- Require the `Typecheck, tests and build` status from the trusted CI application.
- Block force pushes and deletion, with no maintenance-bot administrative bypass.
- Keep `.github/CODEOWNERS`, workflows, policy files, tests, credentials, approval
  enforcement, backend/native code and dependencies under owner review initially.
- Protect release tags and a release environment. Signing secrets are available
  only to trusted release jobs, never PR jobs. Store the previous release for
  rollback. Grant the bot minimal repository permissions via a GitHub App.

Ordinary changes initially cover documentation outside protected policy/setup files.
All UI code is sensitive because CSS or rendering changes can hide approval details.
Backend integrations and self-modification are intentionally sensitive because
JARVIS's security controls live in backend code. A separate reviewer must assess
the exact commit. A model's review is advisory; GitHub enforces merge permission.

No auto-merge workflow is shipped merely to make this policy look operational.
The actual GitHub App, server rules, review service and release environment must
be configured and tested before turning on automatic merges. The proposer must
not approve its own PR or alter the checks that authorize its merge.

Public and personal variants: owner-specific jobs, keys, tunnel addresses and
preferences never enter the upstream source. Generic integrations may be proposed
upstream; personal configuration stays local. Every installation independently
approves updates. Installing Codex does not grant GitHub write access.

Runtime implementation is available in 0.6.0. Register separate GitHub Apps with
Contents write/read respectively, Pull requests write and Checks read, metadata
read automatically; neither gets Administration, Workflows or Commit statuses write.
Install each using selected repositories, jarvis only. Import a private local JSON
file with proposer/reviewer objects containing appId, installationId and privateKey
(the PEM). Never put that file in source or chat. The app encrypts it in the local
vault after validating both installations and active server rules. The original
import file remains at its original location. Keep private keys only on the maintainer
Mac; other users do not need them to consume signed releases.

Configure the main ruleset before credentials: one approval, code-owner review,
dismiss stale reviews, latest-push approval and the trusted GitHub Actions check
Typecheck, tests and build. No app bypass. Source publication asks for an exact
approval, then creates a PR bound to the reviewed diff. After CI the separate app
identity approves it; ordinary docs may merge. Sensitive changes additionally wait
for the actual owner review on GitHub. PR head drift requires new review.
