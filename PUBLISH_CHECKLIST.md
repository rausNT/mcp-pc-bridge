# Publication checklist — publisher/Codex handoff

Do not treat this file or successful compilation as evidence that an installation/security test passed.
Publish a clean, independent repository; never change a predecessor private repository's visibility or push its history.
Preferred project name: `mcp-pc-bridge`. Verify authenticated owner and availability before creating it.
No hosted backend, paid service, marketplace listing or automatic production upgrade is part of this publication.

Publisher scope for this preview: the owner confirmed there is no disposable server/clean Windows test environment and requested local checks and CI. The clean-machine installation, real restricted-SSH and public OAuth gates below remain explicitly pending; this is an experimental source preview, not a claim those gates passed. This exception does not waive source/history/asset scanning, licenses, local tests or CI.

## Gate A — independence from the original infrastructure
- [ ] Review every tracked source/config/template for private domains, IPs, usernames, machine names, paths and shared identifiers.
- [ ] Windows state/key/startup/local port and Linux services/paths belong to this project, not a running predecessor.
- [ ] Domain, certificate paths, SSH host and device id come from the new operator; secrets are generated independently.
- [ ] Complete the exact `docs/DEPLOYMENT.md` runbook on a fresh disposable Ubuntu 24.04 VM and a clean Windows account/VM.
- [ ] Test missing dependencies, occupied ports/existing install, failed npm/download, wrong TLS hostname, unavailable relay, wrong token and mismatched SSH host key.
- [ ] Exercise actual restricted SSH forwarding; prove shell, remote forwarding and Unix-socket forwarding are rejected.
- [ ] Complete new OAuth authorization, harmless synthetic read/write and revocation using the new endpoint. Do not borrow the developer's live installation as proof.

## Gate B — secrets and private history
- [ ] Run `python tools/check_public_tree.py`, plus a dedicated scanner such as Gitleaks; validate installed scanner syntax/version and use redacted reports.
- [ ] Review the source allowlist manually. Never add runtime config, logs, `.env`, DPAPI files, real TLS/private SSH keys or a local publisher note.
- [ ] Scan the brand-new Git history/index and ALL release assets, including extracted archives and strings embedded in the EXE.
- [ ] Use a public/noreply commit identity; do not accidentally publish a private global Git email.
- [ ] If any live credential is found/exposed, do not just delete the line: arrange revocation/rotation through the owner and rescan.
- [ ] Initialize Git in this independent directory; do not copy the original `.git` or automatically mirror branches/tags/releases.

## Gate C — licensing, tests and truthful release claims
- [ ] Retain MIT for bridge-owned source and all third-party notices. Review the lockfiles, runtime download licenses and final packaged licenses.
- [ ] Windows: `go test -v ./...` from `windows/client`.
- [ ] Python helpers: `python -m unittest discover -s tests -v`.
- [ ] Linux relay: `npm ci --ignore-scripts --no-audit --no-fund`, then `npm test` from `server/stage1`.
- [ ] Linux OAuth: `node --test server/stage2/tests/*.test.mjs` from repository root.
- [ ] Linux certificates: `python server/stage2/tests/test_certs.py`.
- [ ] Verify server installers and explicit retirement/rollback instructions on disposable systems.
- [ ] Build with `python tools/build_release.py`; confirm checksums, EXE `version`, archives and plugin manifests. Do NOT execute client `setup/run` against a real system as a build step.
- [ ] Review/pin CI action versions and dependencies. Run both CI jobs before release; CI currently does not publish.
- [ ] Update `docs/VERIFICATION.md` with exact commands, environments and results. Pending tests stay marked pending until actually run.
- [ ] Keep preview/unsigned/no-sandbox limitations prominent. SEC-01..SEC-06 remain future work until their own acceptance gates pass.

## Publication sequence after all applicable gates

Check that the destination repository is new. When an existing name is encountered, inspect it; do not overwrite, delete or alter visibility automatically.
A private staging repository may be used for CI, then made public deliberately; the private predecessor must remain private.
Publish the independent source under MIT, enable an appropriate private security-reporting channel, and create a clearly labelled preview release.
Attach the generated Windows package, plugin TEMPLATE, server archive, source archive and SHA256SUMS. Do not attach a plugin configured for a real private endpoint.
Record the final commit/tag and artifact hashes; verify links and anonymous accessibility only after publication.
Seed roadmap issues from `docs/SECURITY_ROADMAP.md`, retaining acceptance criteria and PLANNED status.
Do not present the current repo's eventual public existence or a successful CI build as proof that the missing sandbox/approval/kill-switch features are implemented.
