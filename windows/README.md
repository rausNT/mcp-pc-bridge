# PC Bridge for Windows — experimental GUI and CLI preview

Use a normal Windows x64 user account, not Administrator. Open `pc-bridge.exe` for the graphical panel, or use `pc-bridge-core.exe` for the console commands below.
The application is unsigned; verify SHA256SUMS and build from source if needed. Do not disable Windows security globally to run it.
Keep the executable in a stable folder you control, not in a temporary download/extraction directory.

The panel's **Set up your PC** page runs configuration and setup using the newly built core. It sends the device token over private stdin, clears the password field, and never puts it into command arguments. Setup does not connect or enable startup. The GUI contains the .NET 10 runtime and extracts its own core under this installation's `core/0.2.0-preview.1` directory on the first explicit action.

Overview reports a loopback port, relay health and matching local processes. **Local components respond** does not prove device authentication or a ChatGPT OAuth session. Status errors clear previous successful observations. Stop/Restart require confirmation and select only the panel's exact core image with rechecked hash and process start time. An independently launched CLI may need Ctrl+C in its own console. Closing the panel leaves a running bridge connected.

## Configure (no connection is started)

```powershell
.\pc-bridge-core.exe configure mcp.your-domain.example desktop
.\pc-bridge-core.exe setup
```

Replace the host with your own SSH DNS name or IPv4 address; the client currently uses SSH port 22.
Use the same device id that you supplied to the server installer.
`setup` reads the server's newly generated DEVICE_TOKEN from hidden console input and stores it using the current user's Windows DPAPI.
Never paste the token into ChatGPT, a GitHub issue, a script or the command-line arguments.
The source/server configuration is not supplied by the developer; you must deploy your own server first.

Setup checks OpenSSH/Node.js, creates a dedicated key if missing, extracts the embedded agent and installs lockfile-pinned npm dependencies with lifecycle scripts disabled.
If OpenSSH is missing, setup stops: install OpenSSH Client through Windows Optional Features, then resume normal-user operation. Setup never installs a Windows capability automatically.
All runtime files are under `%LOCALAPPDATA%\MCP PC Bridge`; the dedicated SSH key is in its `ssh/id_ed25519_pc_bridge` subdirectory.
These locations are distinct from predecessor installations. Never copy production DPAPI/config files into this repository.
For disposable tests, prefix any CLI command with `--state-dir ABSOLUTE-DIRECTORY`; agent, keys, lock and token stay there. Do not use production secrets in tests. Configure/setup/run hold an exclusive OS lock, preventing simultaneous mutation or a second supervisor for the same state directory.

## Authorize and verify SSH

Print the public key using `pc-bridge-core.exe pubkey` and transfer ONLY that `.pub` key to your own server.
Run the server's `authorize-device.py` helper as described in the deployment guide.
Compare the server's SSH host-key fingerprint through a trusted server console before accepting it on Windows.
For first host-key confirmation, run your Windows OpenSSH client with the dedicated identity and `StrictHostKeyChecking=ask`.
The restricted SSH account refuses an interactive shell: that is expected after the host key has been recorded.
Subsequent bridge connections use `StrictHostKeyChecking=yes`; do not bypass this check to silence a mismatch.

## Run and stop

```powershell
.\pc-bridge-core.exe run
```

Keep the console visible. An authenticated device message is stronger evidence than a saved config or running PID.
`pc-bridge-core.exe status` displays configuration presence, NOT a live relay connectivity test.
Ctrl+C/closing the console disconnects the supervisor, but does not guarantee every previously launched external descendant has stopped or undo completed writes.
A complete owner-controlled emergency stop is planned in the security roadmap, not claimed in this preview.

## Optional startup

```powershell
.\pc-bridge-core.exe install-startup
.\pc-bridge-core.exe uninstall-startup
```

Startup is opt-in and uses a visible per-user `MCP PC Bridge.vbs` launcher. Removing startup does not stop an already-running process.
The panel also exposes this opt-in setting with a confirmation. The launcher opens the core console visibly and retains the selected state directory.
Do not delete the active installation directory or copy a new version over a running bridge without a deliberate upgrade/rollback procedure.
To retire the installation, disconnect it, remove its own startup launcher, revoke its server access and explicitly remove its own credentials/runtime after review.
Do not remove shared Node.js/OpenSSH installations or unrelated SSH keys.
