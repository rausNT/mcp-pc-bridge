# Deployment — fresh single-owner installation

This is a preview runbook. Complete the fresh-VM tests in `PUBLISH_CHECKLIST.md` before claiming a verified release.
Never use a real existing bridge as the installer test target.

For the graphical server/Windows/plugin flow, use the [setup wizard](SETUP_WIZARD.md). The steps below are the manual path with an existing TLS certificate; the wizard additionally supports explicit Certbot issuance and renewal.

## Prerequisites

Use a fresh Ubuntu 24.04/systemd server with root access, Python 3.12+, OpenSSL, OpenSSH server/client utilities, `ss`, `tar`, `useradd`, `getent`, `runuser` and enough RAM/disk.
The installer needs at least 1 GiB free under `/opt`; npm/Node installation also requires outbound HTTPS.
TCP 443 and 8787 must be free. Configure DNS for your domain and obtain a publicly trusted matching full-chain TLS certificate/key first.
The supplied helper validates the pair, hostname and remaining validity; it does not by itself prove that the certificate chain is trusted by ChatGPT.
DNS, firewall rules, ACME issuance and renewal are intentionally the operator's responsibility. Do not open server port 8787 publicly.
The direct gateway listens on IPv4 TCP 443; do not advertise an unsupported AAAA endpoint.
The client currently expects SSH port 22. Reverse-proxy integration/nonstandard ports need separate implementation and testing.

## 1. Inspect, preflight, then explicitly install

Extract the source/server archive and enter its `mcp-pc-bridge` directory. Substitute real domain and absolute certificate paths:

```bash
sudo bash server/install.sh --check \
  --domain mcp.your-domain.example --device-id desktop \
  --cert /absolute/path/fullchain.pem --key /absolute/path/privkey.pem

sudo bash server/install.sh --install --accept-remote-command-access \
  --domain mcp.your-domain.example --device-id desktop \
  --cert /absolute/path/fullchain.pem --key /absolute/path/privkey.pem
```

The installer refuses existing project paths/users/occupied ports; it is not an updater.
It creates only its own `/opt/mcp-pc-bridge`, `/etc/mcp-pc-bridge`, `/var/lib/mcp-pc-bridge`, service identities and systemd units.
The relay binds to loopback; the gateway requires OAuth. Separate credentials are generated locally and not printed by the installer.
If installation fails partway, inspect the new paths/users/units before retrying. Do not delete unrelated services or reuse production credentials.

Check `systemctl status mcp-pc-bridge-relay mcp-pc-bridge-gateway` and the operator-controlled domain with a normal validating HTTPS client.
An active service or local health check is not proof of public TLS reachability, Windows access or ChatGPT compatibility.

## 2. Read private setup values locally

```bash
sudo python3 server/show-setup.py
```

Use an interactive trusted terminal: this helper refuses captured/redirected output.
Do not run it through ChatGPT tools. Do not paste/screenshot the values into a chat, issue, README or build log.
`deviceToken` is used on Windows; `clientId` and `clientSecret` go into OAuth connection settings; `ownerPassword` is entered only on your own gateway's consent page.
It is not your ChatGPT, Windows or Linux password.

## 3. Prepare Windows and authorize ONLY its public key

Follow `windows/README.md`: `configure YOUR-HOST desktop`, then `setup` with the newly generated device token.
The local runtime path and key names are separate from predecessor projects. Do not migrate/copy an old installation implicitly.
Transfer the printed SSH public key to the server, for example as `/tmp/device.pub` (never transfer the private key):

```bash
sudo python3 server/authorize-device.py --public-key-file /tmp/device.pub
sudo python3 server/authorize-device.py --public-key-file /tmp/device.pub --configure-ssh
```

The second command explicitly modifies the dedicated SSH identity and its scoped sshd policy and reloads sshd after validation.
It does not replace root/other users' authorized_keys. It checks the effective policy before reloading.
It permits only local TCP forwarding to server loopback 8787 and blocks shells, reverse forwarding and Unix-socket forwarding.
Validate this with actual SSH negative tests on your fresh VM before publication; configuration text alone is insufficient proof.

Get the server host-key fingerprint through your trusted server console, compare it and record it using the Windows OpenSSH client.
Example first contact (use your actual host):

```powershell
ssh -T -i "$env:LOCALAPPDATA\MCP PC Bridge\ssh\id_ed25519_pc_bridge" -o StrictHostKeyChecking=ask mcp-pc-bridge-agent@mcp.your-domain.example
```

A shell/session refusal is expected for this restricted identity; confirm that the correct host key was stored.
Do not use `StrictHostKeyChecking=no`. Then start `pc-bridge-core.exe run` and keep its console visible.

## 4. Customize and connect the plugin

```text
python tools/package_plugin.py --url https://mcp.your-domain.example/mcp --output dist/my-plugin.zip
```

Use your real domain. Public release assets should retain the placeholder template, not the author's live endpoint.
Configure the custom MCP/OAuth connection in your supported ChatGPT account/workspace using current official instructions.
The gateway uses one fixed OAuth client with an exact callback allowlist, not open dynamic client registration.
When ChatGPT provides a supported different callback, add that exact value with:

```bash
sudo python3 server/admin.py add-redirect THE-EXACT-HTTPS-CHATGPT-CALLBACK
```

Do not weaken the allowlist or add a wildcard. Complete the owner consent flow on your own domain.
Start with `dc_remote_status` and a synthetic read/write in a disposable test folder; do not begin with personal files.

## 5. Renewal, disconnect and recovery

The certificate-sync timer copies renewed certificates from the paths you selected and asks only this gateway to reload its TLS context.
It does NOT renew certificates; keep your own ACME/renewal configuration working and test a renewal/rotation.

Ctrl+C closes the client connection. Already-started external processes might continue; no undo or complete kill-switch is promised in the preview.
The graphical panel offers confirmed Stop/Restart for its verified core. Closing the panel itself keeps the bridge running. A successful local health indication does not verify the OAuth session.
Remove the client's opt-in startup launcher with `uninstall-startup` if retiring it.
Revoke all OAuth sessions with `sudo python3 server/admin.py revoke-all`; stop project services when access must remain unavailable.
A full token/key rotation and cleanup must include the device token, OAuth client/owner credentials and the dedicated authorized key as appropriate.
Never remove shared runtimes or unrelated keys/services. Updates and rollback require an explicit procedure; this installer refuses in-place replacement.
