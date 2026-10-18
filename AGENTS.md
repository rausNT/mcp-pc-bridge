# Contributor/agent instructions

Read README.md, SECURITY.md, docs/SECURITY_ROADMAP.md and PUBLISH_CHECKLIST.md before changing this project.
This directory is a standalone public-release preparation, not the running predecessor installation.
Do not modify, delete, restart, migrate or publish the private predecessor project, its Git history, runtime folders, credentials or live services.
Do not initialize a public remote or publish artifacts until the user-authorized publisher completes the release gates.

Keep installation generic: no developer server, device, username, private domain/IP or token in defaults.
Do not weaken OAuth, loopback binding, SSH host-key verification or negative security tests to make a demo pass.
Do not claim complete sandboxing, kill-switch guarantees or per-action approvals until SEC-01..SEC-06 acceptance criteria are met.
Never log secrets while debugging. `OUTCOME_UNKNOWN` is not permission to repeat a write.

Run the Windows, relay, OAuth/TLS and certificate/configuration tests appropriate to their actual target platform.
A passing syntax check is not an end-to-end clean-server installation test.
Build with trimpath and inspect final archives/binaries, not only the working tree.
Preserve MIT attribution and third-party notices. Keep lockfiles and their licenses/integrity under review.
