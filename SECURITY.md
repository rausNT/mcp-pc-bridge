# Security and access model

**Experimental trusted-owner tool. This preview grants broad access as the Windows user.**
It is NOT a filesystem sandbox, a multi-tenant service, or an independently audited security product.
Do not deploy it for untrusted users or assume that selecting a directory confines a shell.

## What exists

The relay is bound to loopback; the public gateway uses HTTPS and single-owner OAuth.
Device and internal MCP tokens are separate. Device credentials are stored using Windows DPAPI.
A restricted SSH identity connects the Windows client to the operator's own relay.
Timeout/lost-output handling reports `OUTCOME_UNKNOWN` instead of blindly repeating writes.

## What does not exist yet

The graphical panel provides local observations and confirmed Start/Stop/Restart, but not verified end-to-end authentication. No complete tray status, full user-facing audit, guaranteed descendant-process kill switch,
local per-action approval broker or enforced selected-folder sandbox is implemented in this preview.
See the accepted [security roadmap](docs/SECURITY_ROADMAP.md), including explicit negative acceptance tests.
Neither OAuth login nor instructions to the model substitute for those protections.

## Data flow

Requests and tool results pass between ChatGPT, your HTTPS gateway, your relay and your computer.
Results can contain file content and command output. Local execution does not mean that all data stays local.
The project tool module has no telemetry or third-party execution engine. Commands can initiate network traffic with the Windows user's permissions; standard runtime dependencies are listed in THIRD_PARTY_NOTICES.md.
Prompt injection in untrusted content can request unintended actions: minimize permissions and inspect important changes.

## Operations

Run as a normal Windows user, not Administrator. Keep the core console visible; autostart is opt-in. Closing the GUI does not stop the core. Its confirmed Stop checks the exact core path, SHA-256 and process start time before a best-effort tree termination; detached jobs may survive.
Closing the console/Ctrl+C disconnects the bridge, but already-started external jobs may continue.
For server-side access revocation use `server/admin.py revoke-all`; it does not undo completed actions.
Do not expose relay TCP 8787, turn off OAuth/TLS checks, or publish a configured live plugin endpoint as a shared service.

Never commit private keys, DPAPI files, runtime config, OAuth credentials, tokens, live logs or environment dumps.
If a credential was exposed, rotate/revoke it; deleting a file or commit is not credential revocation.
Report sensitive findings through [GitHub private vulnerability reporting](https://github.com/rausNT/mcp-pc-bridge/security/advisories/new). Do not open a public issue containing exploit credentials or user data. If private reporting is unavailable, ask the owner for a private channel without disclosing the sensitive details.

This document is not proof that no secrets exist. Scan source/history, archives and binaries before each public release.
References: https://developers.openai.com/api/docs/mcp and https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
