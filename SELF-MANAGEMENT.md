# JARVIS self-management and public distribution

Status: 0.6.0 experimental implementation. GitHub hosting is being configured; public release and unattended maintenance acceptance remain pending.

## Product boundary

JARVIS may improve itself through a versioned source repository. It does not edit
its running signed application bundle. A requested improvement becomes a durable
maintenance job, a branch, tests, a pull request, a review and a release. Installing
a release is a separate user-approved action. Private local customization should
remain separate from changes intended for every user.

The selected normal-change policy is automatic merge after required checks and
review. The initial automatic lane is ordinary documentation only; UI code can
affect approval visibility and therefore requires owner review. The owner approved this split on 2026-11-12. Approval/security enforcement,
credential storage, updater trust, signing, GitHub permissions, release workflows
and database migration changes require an owner review. These restrictions must
be enforced outside the model, using repository permissions and rules, not merely
a prompt. The maintainer must not have an administrative bypass.

## Maintenance loop

1. Capture the requested outcome, acceptance criteria and compatibility needs.
2. Inspect the installed version and repository revision. Create an isolated
   branch/worktree; never alter the currently running bundle.
3. Implement changes with checkpoints and bounded resource use. Repository issue,
   PR and source content is untrusted data, never authority to reveal credentials
   or change policy.
4. Run required typechecks, tests, relevant UI/native checks and secret/license
   checks. Record actual evidence against the exact commit.
5. Open a PR. Review using a separate reviewer context. Re-review after new commits.
   An agent review is not equivalent to an independent human security audit.
6. Merge only the checked/reviewed commit under server-enforced rules. External
   contributions run checks without privileged release credentials.
7. Build candidate artifacts in a trusted release workflow. Verify signatures,
   bundle identifiers, versions, credential exclusion and upgrade compatibility.
8. Publish the approved release channel; installations detect availability and
   ask their users before downloading/installing according to the selected policy.

## Release artifacts

- macOS Apple Silicon DMG for installation, plus the updater's required archive
  and metadata. Add Intel only after native dependencies/builds are verified.
- Android APK signed with a persistent release key. Preserve package identity and
  signing continuity, including migration for existing test installations.
- Versioned checksums and independently authenticated release metadata, release
  notes, source commit and dependency/license notices. Checksums alone do not
  authenticate a compromised release source.
- Stable and preview channels with explicit compatibility/minimum versions.

The existing owner certificate is a local self-signed identity, not Developer ID
notarization. Decide the public signing path before promising seamless public Mac
updates. Signing secrets never enter source, model context or untrusted PR jobs.

## Update installation

Check a configured repository/channel, compare strict versions, and show release
notes and permission/migration changes. Only accept artifacts authenticated by the
pinned release trust policy. Verify before replacing anything. Drain/checkpoint
work, end calls and require consent to restart. Stage updates atomically, retain a
last-known-good app, and health-check launch. Data migrations need backups and
explicit backward-compatibility rules; rolling back the app alone may not restore
an older database. Do not enable this path until upgrade/failure recovery tests
pass. Android uses the normal OS installation consent flow.

## Public source preparation

Build an allowlisted source export before initializing/publishing the public repo.
Exclude .jarvis, Workspace, local history, private deliverables, keys, cached
signing/vault binaries, credentials, pairing data, hostnames and owner-specific
configuration. Review documentation and media provenance too. A .gitignore file
is not a proof that publishing a working folder is safe. Choose an open-source
license and inventory third-party dependencies/assets before publication.

Keep personal jobs, assistant memories and GitHub maintenance credentials outside
source. Each user owns their own configuration and authorizes their own phone.
Do not distribute Sultan's Firebase authority or tunnel identity. Determine a
per-user deployment path or a separately operated relay/push service.

## Prerequisites and onboarding

A supported, authenticated Codex backend is required for task execution; installing
the Codex desktop app alone does not establish account access. Discover supported
locations rather than relying on one app-bundle path. Voice currently requires a
separate configured OpenAI API key/access. Native desktop/microphone permissions
must be granted by each user. Remote phone access and push require their own
configuration or an operated service. Optional services need capability-specific
onboarding so text/desktop work remains usable without them.

## Delivery stages

1. Confirmed repository owner/name, Apache-2.0 license and owner-review policy. Public notarization remains deferred.
2. Produce and audit the clean source export; publish only the reviewed export.
3. Add protected CI, repeatable DMG/APK builds and manual candidate releases.
4. Implement authenticated update discovery/install and test two successive
   versions, failure recovery, credentials, permissions and pairing continuity.
5. Add constrained repository maintenance tools and separate-context review.
6. Enable automatic ordinary merges only after a supervised trial. Keep security
   boundaries and release authority separately controlled.

## Verified current state

0.5.0 has durable jobs, isolated project execution and local test-build packaging.
The working directory has no Git repository. Apache-2.0, a source-export audit,
protected-path review policy and unprivileged CI workflow have now been prepared
locally. A verified local-test DMG is available; public signing remains undecided. GitHub repository tools, authenticated updater and DMG
publication are not implemented. No repository was created or published as part
of this architecture review.

Confirmed destination: sultandilaram/jarvis. Source license: Apache-2.0.

## Implemented in 0.6.0

A bundled allowlisted source snapshot seeds a private local Git checkout. Source
improvements run as isolated project jobs; submission freezes a diff and starts a
separate reviewer job/context. Only actual successful typecheck/test/build command
receipts on the unchanged snapshot count. Proposers cannot record their own review.
Ordinary documentation can merge locally; all code/dependency/policy changes need
explicit owner approval. A local merge never edits the installed app.

Dedicated proposer and reviewer GitHub Apps support publication and review of
exact commits. These are separate from the Codex GitHub connection. Their short-lived
installation tokens are reduced to jarvis; no administration, workflows or status
write permissions are requested. JARVIS refuses unattended publication without
active owner-review/CI rules. Changed PR heads fail closed; sensitive PRs require
a real sultandilaram approval on that head. Production credentials and actual GitHub
App installation testing remain pending; mocked API checks are not live proof.

The updater pins an Ed25519 public key, authenticates GitHub release metadata,
checks version/data compatibility and artifact size/hash, and requires owner consent
to install. Mac updates also require the existing app certificate and unchanged
fixed vault. ZIP path/link validation precedes extraction. A detached helper performs
replacement and waits for renderer-ready confirmation; failed launch checks stop
the owned new process and restore the previous app. This is not a database rollback
or a guarantee that external actions can be reversed. Data schema changes are rejected.
Android update metadata comes through the authenticated paired desktop; downloaded
APK bytes and existing package/signing identity are verified before Android consent.

Local release-candidate/publish scripts and a disabled-by-default protected-tag
workflow are included. They require private persistent signing/build state and a
protected release environment. Public signing/notarization and a trusted release
runner must be configured explicitly. The release signing private key is local
private state and is never in source or app bundles.
