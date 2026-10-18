# Publication checklist — publisher/Codex handoff

Do not treat this file or successful compilation as evidence that an installation/security test passed.
Publish a clean, independent repository; never change a predecessor private repository's visibility or push its history.
Preferred project name: `mcp-pc-bridge`. Verify authenticated owner and availability before creating it.
No hosted backend, paid service, marketplace listing or automatic production upgrade is part of this publication.

Publisher scope for this preview: the owner confirmed there is no disposable server/clean Windows test environment and requested local checks and CI. Full clean-Windows/public-VPS wizard acceptance and public OAuth remain explicitly pending; disposable CI now checks the Linux installation and real restricted SSH; this is an experimental source preview, not a claim those gates passed. This exception does not waive source/history/asset scanning, licenses, local tests or CI.

## Gate A — independence from the original infrastructure
- [x] Review every tracked source/config/template for private domains, IPs, usernames, machine names, paths and shared identifiers.
- [x] Windows state/key/startup/local port and Linux services/paths belong to this project, not a running predecessor.
- [x] Domain, certificate paths, SSH host and device id come from the new operator; secrets are generated independently.
- [ ] Complete the exact `docs/DEPLOYMENT.md` runbook on a fresh disposable Ubuntu 24.04 VM and a clean Windows account/VM.
- [ ] Test missing dependencies, occupied ports/existing install, failed npm/download, wrong TLS hostname, unavailable relay, wrong token and mismatched SSH host key.
- [x] Exercise actual restricted SSH forwarding; prove shell, remote forwarding and Unix-socket forwarding are rejected.
- [ ] Complete new OAuth authorization, harmless synthetic read/write and revocation using the new endpoint. Do not borrow the developer's live installation as proof.

## Gate B — secrets and private history
- [x] Run `python tools/check_public_tree.py`, plus a dedicated scanner such as Gitleaks; validate installed scanner syntax/version and use redacted reports.
- [x] Review the source allowlist manually. Never add runtime config, logs, `.env`, DPAPI files, real TLS/private SSH keys or a local publisher note.
- [x] Scan the brand-new Git history/index and ALL release assets, including extracted archives and strings embedded in the EXE.
- [x] Use a public/noreply commit identity; do not accidentally publish a private global Git email.
- [ ] If any live credential is found/exposed, do not just delete the line: arrange revocation/rotation through the owner and rescan.
- [x] Initialize Git in this independent directory; do not copy the original `.git` or automatically mirror branches/tags/releases.

## Gate C — licensing, tests and truthful release claims
- [x] Retain MIT for bridge-owned source and all third-party notices. Review the lockfiles, runtime download licenses and final packaged licenses.
- [x] Windows: `go test -v ./...` from `windows/client`.
- [x] Python helpers: `python -m unittest discover -s tests -v`.
- [x] Linux relay: `npm ci --ignore-scripts --no-audit --no-fund`, then `npm test` from `server/stage1`.
- [x] Linux OAuth: `node --test server/stage2/tests/*.test.mjs` from repository root.
- [x] Linux certificates: `python server/stage2/tests/test_certs.py`.
- [ ] Verify server installers and explicit retirement/rollback instructions on disposable systems.
- [x] Build with `python tools/build_release.py`; confirm checksums, EXE `version`, archives and plugin manifests. Do NOT execute client `setup/run` against a real system as a build step.
- [ ] Review/pin CI action versions and dependencies. Run all three CI jobs before release; CI currently does not publish.
- [x] Update `docs/VERIFICATION.md` with exact commands, environments and results. Pending tests stay marked pending until actually run.
- [x] Keep preview/unsigned/no-sandbox limitations prominent. SEC-01..SEC-06 remain future work until their own acceptance gates pass.

## Publication sequence after all applicable gates

Check that the destination repository is new. When an existing name is encountered, inspect it; do not overwrite, delete or alter visibility automatically.
A private staging repository may be used for CI, then made public deliberately; the private predecessor must remain private.
Publish the independent source under MIT, enable an appropriate private security-reporting channel, and create a clearly labelled preview release.
Attach the generated Windows package, plugin TEMPLATE, server archive, source archive and SHA256SUMS. Do not attach a plugin configured for a real private endpoint.
Record the final commit/tag and artifact hashes; verify links and anonymous accessibility only after publication.
Seed roadmap issues from `docs/SECURITY_ROADMAP.md`, retaining acceptance criteria and PLANNED status.
Do not present the current repo's eventual public existence or a successful CI build as proof that the missing sandbox/approval/kill-switch features are implemented.

Evidence and scope: [VERIFICATION.md](docs/VERIFICATION.md). The mixed negative-installation and retirement/rollback checklist items stay open where full manual coverage is absent. No live credential findings required rotation. The private staging repository was created only after the checked source/history gate.
