# Verification record

Date: 2026-10-18. Candidate: `0.2.0-preview.1`. Results apply to the independent public candidate, not a predecessor installation.

## Completed local checks

- Windows 11 host: Python 3.12 preparation/configuration/plugin/key-format/secret-scanner/dependency-policy tests: **14 passed** (`python -m unittest discover -s tests -v`). Temporary test state is separate from any installed bridge.
- Go 1.27.2: **8 tests passed**, including exclusive state lock, isolated configuration, DPAPI, ZIP traversal rejection and real portable bootstrap (`MCP_BRIDGE_TEST_BOOTSTRAP=1 go test -v ./...`). Bootstrap excluded installed Node from PATH, downloaded SHA-256-verified Node 24.21.0, installed the single pinned `ws` dependency with hooks disabled and created only a disposable synthetic key/token/config. This is not a clean Windows VM acceptance run.
- Original PC tools/agent: **8 tests passed** on Windows and Linux, covering synthetic file operations, argument rejection, process execution/output bounds, timeout/stop and duplicate write suppression across a real loopback WebSocket reconnect.
- Real local MCP relay: **15 tests passed** on Windows, including MCP client → relay → original agent → synthetic file read/write and harmless process. Separate relay tests cover auth failures, discovery, deduplication and disconnect without retry. No private server or files were used.
- Linux WSL Ubuntu 26.04, Python 3.14.4, Node 24.21.0: **14 preparation, 8 agent, 14 relay, 46 OAuth/gateway tests and 8 certificate tests passed** on a temporary native Linux filesystem. This environment is not the Ubuntu 24.04 deployment target. The additional real-PC MCP integration test was added afterward and passed on Windows; CI runs it on Ubuntu 24.04.
- WPF/.NET 10 tests passed: isolated synthetic core start/restart/tree stop, duplicate and occupied-port rejection, unrelated-process survival, malformed config and real loopback health. Wizard tests cover input rejection, SSH quoting, explicit install flags and secret-free personal OAuth plugin packaging. Five panel pages and seven wizard steps render; representative screens were visually checked.
- `python tools/check_dependencies.py --installed`: **90 lockfile entries** match exact reviewed versions/origins/integrity/license text hashes (1 Windows + 89 server entries). Missing licenses, version changes, local dependency links and install hooks are rejected by regression tests. Desktop Commander and its dependency tree were removed.
- `npm audit --omit=dev`: **zero known vulnerabilities** in both current trees. Point-in-time advisory result, not a security certification.
- Gitleaks 8.30.1: no findings in the candidate source snapshot, nested release archives, or extracted printable ASCII/UTF-16 executable strings. The binary strings were also checked against known predecessor identifiers. Gitleaks does not prove absence of secrets in arbitrary binary formats; embedded payload hashes are checked separately.
- `python tools/check_public_tree.py`: passed. Source files, public plugin placeholders and separate state/service names reviewed. No predecessor Git history or runtime credentials copied.

## Release and CI gates

A new root-only Git history was created in `project/` and scanned with Gitleaks: no findings. Commit identity uses the owner's public GitHub noreply address. The predecessor repository/history were not touched.

`python tools/verify_release.py` passed locally, including all six asset checksums, archive path/integrity checks, plugin placeholders, EXE version, byte-for-byte matching embedded server/plugin/core payloads and embedded license texts. Standalone executables retain their required notices.

[Initial CI run](https://github.com/rausNT/mcp-pc-bridge/actions/runs/39115247350): Ubuntu 24.04 Linux tests and the real disposable-server installation/SSH acceptance passed. The server test installed dedicated services, rejected a second installation without changing credentials, established real local SSH forwarding and confirmed shell/reverse TCP/Unix forwarding denial. It used a synthetic certificate and a GitHub-hosted runner; it did not test public DNS/ACME/ChatGPT consent. Windows build results and final commit/tag are linked in the release notes.

CI is configured for Ubuntu 24.04 and Windows 2025: license/audit checks, original agent tests, relay/OAuth/certificate tests, WPF/Go tests and final packaging. Publication requires all three jobs to pass for the released commit. Public visibility and anonymous download checks are performed only after that gate.

## Explicitly unverified

- A complete wizard run on a clean Windows VM/account and independently provisioned public VPS.
- Public DNS/firewall reachability, real ACME issuance/renewal, public trust chain and a new ChatGPT OAuth/plugin session with synthetic read/write and revocation.
- Upgrade or migration of an existing private installation. The wizard deliberately refuses existing installation paths/services. The user's working PC bridge/server have not been modified by these checks.
- SEC-01 through SEC-06 remain planned, including complete authenticated status/audit, guaranteed descendant termination, independent local dangerous-action consent and genuine OS-enforced workspace isolation.

The owner confirmed no standalone test environment is available and requested local checks plus CI. The preview discloses these limits instead of treating the private production installation as a test substitute.
