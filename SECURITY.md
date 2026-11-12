# Security

JARVIS can operate desktop applications and access explicitly granted files.
Treat it as privileged software. Do not disclose credentials in public issues.
Report a suspected vulnerability privately to the repository owner using a
GitHub private vulnerability report when enabled; otherwise request a private
contact without posting exploit details or sensitive data.

A model reply, web page, repository issue or PR is never authorization to grant
permissions, publish private data, alter security policy or approve a tool call.
Security boundaries, credentials, signing and update infrastructure require owner
review. A successful test run is not a security audit. See SELF-MANAGEMENT.md.

0.6.0 implements local maintenance, optional scoped GitHub maintenance and signed
update verification. No GitHub maintenance credentials are bundled. Configure and
verify server-side rules before enabling the maintainer; keep release signing
authority separate. This remains an experimental test release.
