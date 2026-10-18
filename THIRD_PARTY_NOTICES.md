# Third-party components

The bridge, graphical panel, installers and PC tool module are project code under MIT. Desktop Commander and its dependencies are not installed, copied or bundled.

The Windows agent has one npm dependency: `ws` 8.21.3 (MIT). The server lockfile has 89 entries with declared MIT, ISC, BSD-3-Clause or Apache-2.0 licenses. Exact package versions, registry URLs, archive integrity and license-file hashes are preserved in [licenses/npm-inventory.json](licenses/npm-inventory.json); all their upstream license texts are in [licenses/npm-THIRD-PARTY.txt](licenses/npm-THIRD-PARTY.txt).

The MCP SDK's actual license notice describes Apache-2.0 for new/relicensed code, MIT for earlier contributions not relicensed, and CC-BY-4.0 for upstream documentation. Its full mixed notice is retained; the packages must not be described as MIT-only. This project does not copy SDK documentation into its own documentation.

`python tools/check_dependencies.py` rejects a changed inventory, unknown license, non-registry source, missing integrity or install hook. `--installed` also compares actual installed license texts. Maintainers must review changed packages before explicitly running `--record`. CI and builds never automatically approve new inventory entries. Setup uses `npm ci --ignore-scripts`; no package lifecycle hooks are executed.

The Go core embeds original project JavaScript and the approved npm manifests/lockfile. It does not embed a Node installation. Official Node archives are downloaded during setup with SHA-256 verification and retain their license files. The core includes the Go standard library; its BSD license is in `licenses/GO-LICENSE.txt`.

The GUI includes the .NET 10.0.8 Windows Desktop runtime. The complete license and third-party notices are in `licenses/dotnet-*`. There are no external NuGet application libraries. The GUI embeds the newly built core, reviewed server source archive and unconfigured plugin template. No SSH.NET or predecessor binary is included.

OpenSSH, Python, OpenSSL, systemd, Certbot and operating-system packages are separately installed prerequisites and retain their upstream/distribution licensing. They are not relicensed by this project's MIT license. See [dependency policy](docs/DEPENDENCIES.md).

No endorsement by OpenAI, GitHub, Microsoft, Node.js or Go is implied.
