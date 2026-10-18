# PC Bridge setup wizard

Download the Windows package, check SHA256SUMS and open `pc-bridge.exe` → **Setup wizard**.
The wizard covers your own server, Windows application, pairing and ChatGPT plugin preparation.
The server code and plugin template embedded in the EXE are generated from this repository during the same build.

1. **Welcome:** review remote-command access. Next installs the EXE into your per-user Programs folder with a Start menu shortcut unless you clear that option. No automatic startup is added.
2. **Your server:** enter a root SSH host, your public DNS domain and device ID. Use a fresh Ubuntu 24.04/systemd server with ports 22, 80 and 443 reachable. Keep relay port 8787 private. Supply an existing certificate pair, or enter an email and accept Let's Encrypt's terms for automatic HTTPS.
3. **Install server:** review the concrete destination and changes. Native OpenSSH asks for host-key confirmation/passwords locally. The wizard uploads the reviewed server bundle, installs prerequisites, creates independent secrets, installs the relay/gateway, and optionally obtains a certificate with Certbot and enables renewal. It refuses an existing installation or occupied ports. Existing-server mode verifies HTTPS without reinstalling.
4. **Windows setup:** show setup values in your private SSH terminal and enter only `deviceToken` into the password field. The core downloads/checks its portable runtime when needed and installs pinned dependencies. It creates a dedicated SSH key and stores the token using Windows DPAPI. Keep OAuth credentials for ChatGPT; never paste them into a conversation.
5. **Pair and start:** upload only the public SSH key, validate and reload the dedicated SSH policy, test forwarding and start the visible core console.
6. **ChatGPT plugin:** enter the public `clientId`, generate a personal ZIP, and open ChatGPT Plugins. Use **+ → Add custom MCP server**, enter your HTTPS `/mcp` URL and OAuth credentials in the connection UI, review the risk warning and finish consent on your own domain. If ChatGPT supplies a different supported callback, add that exact value through the wizard. Verify `dc_remote_status` before checking the confirmation box.
7. **Finish:** the panel reports local observations; the OAuth completion checkbox is the owner's confirmation, not an independently verified session.

The personal ZIP contains the endpoint and public OAuth client ID, never a device token/client secret/owner password. It can be used in a supported import/local-marketplace flow. Creating it does not install a plugin or bypass the account/workspace's permissions. The public release contains only the non-working template.

## Prerequisites that cannot be inferred

The wizard does not purchase a VPS/domain, modify your DNS provider or firewall, bypass SSH host-key checks, log in to ChatGPT on your behalf, or accept its OAuth consent. Root SSH login must be available for this preview's automated server path. Password-based SSH can prompt more than once; existing SSH keys/agent authentication are also usable. OpenSSH Client must be installed through Windows Optional Features if missing.

The direct gateway serves IPv4 HTTPS. Point an A record at the server; do not publish an unsupported AAAA record. Automatic Certbot renewal uses HTTP-01: TCP 80 must remain available and reachable. The project's certificate-sync timer loads renewed certificates; test renewal separately.

## Interrupted steps

The wizard records a server install attempt before the first remote write. Closing a terminal or losing SSH can leave `OUTCOME_UNKNOWN`; automatic reinstall is blocked. Pairing likewise checks actual SSH access before repeating any authorization and records attempted writes. Use **Inspect server state**, inspect its units/paths and the local `wizard/server-attempt.json` receipt. If installation succeeded, reopen the wizard using **already installed**. Do not delete the receipt or server paths just to bypass an error; investigate a partial installation first.

This is a fresh-install preview, not an automatic upgrade/migration tool. It does not update an existing bridge. Full VPS/ACME/ChatGPT wizard acceptance remains pending without a disposable public test environment; local tests/CI do not establish those claims.

## Official connection references

- [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Plugin packaging and provided OAuth clients](https://developers.openai.com/plugins/build/plugins)
- [OAuth requirements and exact callbacks](https://developers.openai.com/plugins/build/auth)
- [Let's Encrypt agreements](https://letsencrypt.org/repository/)
