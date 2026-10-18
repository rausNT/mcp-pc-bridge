# Changelog

## 0.2.0-preview.1

- Fully self-hosted relay and HTTPS/OAuth gateway with independent installation secrets.
- WPF Windows panel: setup, local diagnostics, SSH checks and confirmed Start/Stop/Restart.
- Seven-step setup wizard for the Windows app, fresh Ubuntu 24.04 server, optional ACME HTTPS, restricted SSH pairing and personal plugin preparation. ChatGPT consent remains in the owner's account.
- Original PC file/process tools replace Desktop Commander and its transitive dependency tree. Windows now requires one npm library (`ws`); all remaining dependency versions and license texts are reviewed and checked by the build.
- Isolated Windows state, DPAPI token storage, explicit startup, verified portable Node bootstrap and no npm lifecycle scripts.
- Synthetic end-to-end MCP tests, GUI process tests, Linux OAuth/certificate tests and CI fresh-server acceptance.
- Experimental preview: broad Windows-user access; SEC-01..SEC-06 remain planned. Public DNS/ACME/new ChatGPT OAuth and a full clean-Windows wizard run are not claimed verified. See VERIFICATION.md.
