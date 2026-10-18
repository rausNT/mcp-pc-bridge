# MCP PC Bridge

**A self-hosted bridge from ChatGPT to your Windows PC.**

**Your server. Your computer. An open-source bridge.**

Host the entire bridge on infrastructure you control: the Windows application, relay and HTTPS/OAuth gateway are open source, with deployment scripts and a plugin template included. Use your own server or VPS and change the code to suit your installation.
This is not a hosted service or an official OpenAI product.

**Security warning:** this preview exposes file access and command execution as your Windows user. It has no enforced selected-folder sandbox or local per-action approval broker. Read [SECURITY.md](SECURITY.md) before connecting it.

[Русская инструкция](README_RU.md) · [Deployment](docs/DEPLOYMENT.md) · [Security roadmap](docs/SECURITY_ROADMAP.md) · [Publication checklist](PUBLISH_CHECKLIST.md)

## Architecture

```text
ChatGPT / MCP client
        ↕ HTTPS + single-owner OAuth
Your server: gateway → loopback MCP relay
        ↕ outbound SSH tunnel from Windows
PC Bridge graphical panel → Windows supervisor → Node agent → built-in PC tools
```

You supply your own server/domain and credentials. No developer server address or shared token is supplied.
The relay listens on server loopback TCP 8787. The public gateway uses TCP 443.
The Windows client uses local loopback TCP 18890 by default and a dedicated SSH key/account.
Requests and results traverse ChatGPT and your server; local execution is not a promise that data never leaves your PC.

## Why self-hosted?

You operate the whole bridge, including its server side. No mandatory author-operated relay, relay-service account or intermediary subscription is required. You control its domain, credentials, deployment and source code.

ChatGPT and the model are **not** hosted locally. You still need a supported ChatGPT account/workspace, a server, domain and publicly trusted TLS certificate. Runtime and package downloads require external services. ChatGPT, hosting and domains may cost money; their providers' terms apply. This is not an offline product, and self-hosting is not a security sandbox.

## Included

- `windows/client/`: Go Windows supervisor, original [PC tools](docs/PC_TOOLS.md), agent, one reviewed npm dependency and tests.
- `windows/gui/`: PC Bridge WPF panel, including setup, local status, SSH diagnostics and confirmed Stop/Restart.
- `windows/gui-tests/`: isolated process lifecycle tests and WPF rendering checks.
- `server/`: generic fresh-install scripts, loopback relay, HTTPS/OAuth gateway and tests.
- `plugin/`: editable plugin template. `mcp.example.invalid` is intentionally non-working.
- `tools/`: public-tree checks, plugin customization and release packaging.
- `docs/`: deployment, verification status and accepted security requirements.

## Start here

1. Read the access model, download the Windows package and verify SHA256SUMS.
2. Open `pc-bridge.exe` and select **Setup wizard**. Next installs the app locally, then guides you through your own fresh Ubuntu 24.04 VPS, DNS domain, HTTPS and Windows pairing.
3. Review the server changes before installation. SSH host-key/password prompts stay in your local terminal. The wizard can obtain and renew a Let's Encrypt certificate, or use a certificate pair you supply.
4. Finish the ChatGPT plugin/OAuth step in your own account and check `dc_remote_status` and a harmless synthetic file.

See [the seven-step wizard](docs/SETUP_WIZARD.md) or the [manual deployment guide](docs/DEPLOYMENT.md). DNS, VPS purchase, firewall configuration and ChatGPT consent require the owner. The wizard refuses existing installation paths and occupied ports; it does not migrate a working bridge.
Only one trusted owner and one configured computer per relay are intended in this preview.
Availability of custom MCP connections/plugins depends on the ChatGPT account/workspace; consult current official documentation before deployment.

## Customize the plugin

```text
python tools/package_plugin.py --url https://mcp.your-domain.example/mcp --output dist/my-plugin.zip
```

Use your real DNS name instead of the example. Do not put credentials into the URL or archive.
The package itself does not register OAuth or prove that the device is connected.

## Test and build

Windows: Go 1.27 and .NET 10 SDK for building. The release GUI includes the .NET runtime; the deployed core uses OpenSSH and Node.js. Setup reuses Node 24 or downloads the pinned portable runtime. Install a missing OpenSSH Client through Windows Optional Features, then use a normal account.
Server target: Ubuntu 24.04, systemd, Python 3.12+, OpenSSL and Node 24 (isolated download during installation).

```text
python -m unittest discover -s tests -v
python tools/check_public_tree.py
cd windows/client
go test -v ./...
```

From the repository root:

```text
python tools/build_release.py
```

`dist/` contains a Windows package, plugin template, server source archive, full source archive and SHA256SUMS.
The Windows package contains `pc-bridge.exe` (GUI) and `pc-bridge-core.exe` (CLI). The GUI embeds the core, reviewed server source bundle and unconfigured plugin template built from this source tree; it contains no predecessor binaries or server credentials. Build restoration may download official .NET packages.
Building does not connect to a computer, deploy a server, enable startup or publish to GitHub.
[Verification status](docs/VERIFICATION.md) distinguishes tests already run from pending clean-machine checks.

## Status and contribution

Prepared version: `0.2.0-preview.1`, experimental and not declared production-safe.
See the [dependency policy](docs/DEPENDENCIES.md). Read [AGENTS.md](AGENTS.md) and the [accepted safety roadmap](docs/SECURITY_ROADMAP.md).
The panel reports local port/relay/process observations, not proof of device authentication or a ChatGPT OAuth session. Full authenticated status, complete action history, guaranteed emergency stop, independent dangerous-action approval and actual restricted-workspace isolation remain planned work with explicit acceptance criteria.
Closing the panel leaves the core running. Stop verifies the exact installed core path, hash and process start time before attempting to terminate its tree; detached jobs may survive. These controls do not complete SEC-01 or SEC-03.

Clean-machine installation and a new public ChatGPT OAuth connection remain unverified; see the exact [verification record](docs/VERIFICATION.md). This preview must not be presented as a production-ready release.
PRs and forks are welcome. Do not submit real credentials, private files or unsanitized logs.

## License and upstream

Bridge code: MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The PC tool implementation is original project code. Desktop Commander is not installed or bundled. Reviewed libraries and runtimes retain their own notices.
Primary reference: https://developers.openai.com/plugins/build/mcp
