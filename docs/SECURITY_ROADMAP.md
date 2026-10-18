# Security roadmap — accepted requirements

Status: PLANNED, not implemented as complete features in `0.2.0-preview.1`.
The owner accepted these requirements for subsequent releases. They are release work, not optional marketing ideas.
Release ordering below is proposed; there is no promised calendar date.
Do not tick a requirement complete without tests, evidence and documentation of remaining limitations.

## Next release: visible control and audit

### SEC-01 — Visible connection and execution state
- [ ] Persistent Windows tray/window indicator: disconnected, connecting, authenticated/online, executing, awaiting approval, paused/revoked, error.
- [ ] Online means a fresh authenticated relay handshake/heartbeat, not merely an EXE, PID, configuration file or saved token.
- [ ] Display the destination server, local device/user, active access mode, last interaction and active jobs without exposing credentials.
- [ ] Startup behavior must be explicit and visible. Installation/configuration alone must not silently grant persistent remote access.
- [ ] Acceptance: remove network, stop relay, expire credentials, lock/unlock Windows and restart the app; UI reflects actual state without showing a stale green status.
The preview's visible console and configuration-only `status` command do not complete this requirement.

### SEC-02 — Understandable local action history
- [ ] Record request/correlation id, time, initiating connection, tool/action class, safe target summary, decision, start/end, result, and affected artifact hashes when appropriate.
- [ ] Distinguish planned, awaiting approval, denied, queued, started, completed, failed, cancelled and outcome unknown.
- [ ] Record reads and external transfers as well as writes. Allow the owner to inspect and export a redacted history.
- [ ] Default logs must not contain tokens, passwords, cookies, private keys, whole files, complete environment dumps or sensitive command output.
- [ ] Rotation, retention, filesystem permissions and behavior on full disk must be explicit; do not silently approve when audit recording fails.
- [ ] Acceptance: success, denial, crash, reconnect and lost result each leave a truthful record; planted secrets never appear in default logs.
An in-memory deduplication ledger are not the complete user-facing history promised here.

### SEC-03 — Local emergency disconnect
- [ ] A readily accessible local button/hotkey stops acceptance of new work without needing ChatGPT, a network round trip or model cooperation.
- [ ] Cancel queued requests and pending approvals, revoke the live session and close relay/tunnel connections.
- [ ] Control the owned process tree; explicitly account for child/grandchild/background processes, detached jobs and elevated processes.
- [ ] Do not kill unrelated user processes. Do not claim rollback of writes or interruption of actions already completed elsewhere.
- [ ] Stay paused across reconnects/restarts as appropriate; no automatic re-enable after an owner emergency stop.
- [ ] Acceptance: during transfers, shell jobs and network loss, new actions are blocked immediately; separately measure/document actual descendant termination latency.
Closing today's console is a best-effort disconnect, not this complete kill-switch guarantee.

## Following release: independent authorization

### SEC-04 — Separate approval for potentially dangerous actions
- [ ] Enforce approval in a local policy/broker layer, independent of model instructions and tool descriptions.
- [ ] Show the actual target, exact operation/command, destination for network transfer, expected changes and backup/rollback limits.
- [ ] Require explicit approval for deletion/overwrite, arbitrary command execution, permission/registry/firewall changes, new persistence, installs, credentials and external data transmission.
- [ ] Bind an approval to the precise canonical arguments/payload digest, identity, scope and short expiry; deny on substitution or replay.
- [ ] A document, webpage, tool output or model call cannot manufacture the user's local click or elevate its own permissions.
- [ ] Deny on absent UI, timeout, broker error, session revocation or policy ambiguity. No broad silent 'always allow' by default.
- [ ] Acceptance: altered arguments, late approval, replay, encoded PowerShell/Python, nested scripts and remote disconnection cannot bypass decisions.
Server OAuth consent authorizes a connection; it does not satisfy per-action approval.

## Following release: genuine limited-workspace mode

### SEC-05 — Real selected-folder access boundary
- [ ] Specify the threat model and choose an enforceable architecture: OS-isolated execution identity/sandbox/VM with explicit mounts, or a typed broker with no unrestricted host-shell escape route.
- [ ] Cover reads, writes, search, metadata, archives, subprocesses, Python/PowerShell/native executables, registry/API access and network egress.
- [ ] Cover canonicalization, `..`, case variants, 8.3 paths, UNC/device paths, alternate data streams, symlinks/junctions/reparse points, hardlinks, races and inherited handles.
- [ ] A child process cannot inherit wider host access, tokens or credentials. Network destinations need a separate policy; folder restrictions alone do not prevent exfiltration.
- [ ] Fail closed if isolation cannot be established. Full-computer mode is a separate, explicit, clearly labelled opt-in mode.
- [ ] Acceptance: an automated adversarial matrix attempts every escape from the restricted mode using all exposed tools; outside access fails at the enforcement layer.
- [ ] Never label a configured folder list, string-prefix path checks, command deny-lists or a prompt instruction as a filesystem sandbox for arbitrary processes.

## Cross-cutting: untrusted content and release tests

### SEC-06 — Prompt-injection and exfiltration regression tests
- [ ] Plant instructions in documents, HTML, filenames and tool responses that ask to read another directory, transmit secrets, enable startup, disable protections or self-approve.
- [ ] Verify independent policy enforcement even when the model asks to comply. Do not promise total prompt-injection prevention.
- [ ] Test across disconnect/reconnect, `OUTCOME_UNKNOWN`, process restart, policy change and multiple concurrent requests.
- [ ] Keep fixtures synthetic; never use production keys, tokens or a real user's private files.

## Definition of done for a security release

Code + automated negative tests + manual Windows acceptance + documented data flow + honest known limitations.
All default modes, fail-closed states and emergency-stop behavior must be documented before claiming completion.
The installer may not silently migrate/restart a working older bridge to deliver these features.

## Primary references

- OpenAI MCP security guidance: https://developers.openai.com/api/docs/mcp
- OpenSSH forwarding controls: https://man.openbsd.org/sshd_config
