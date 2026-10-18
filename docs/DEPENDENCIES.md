# Dependency and provenance policy

The local PC tools are original project code in `windows/client/pc-tools.mjs`, mirrored into `server/stage1/src/` for standalone agent testing. They use Node standard APIs. No Desktop Commander implementation, package, telemetry module, document converter, browser download or native image library is included. This is a deliberate replacement, not a renamed third-party implementation. The new tool names and supported operations are documented in [PC_TOOLS.md](PC_TOOLS.md).

The release is not described as containing no third-party code. It uses reviewed, explicitly licensed libraries and standard runtimes:

| Component | Included or obtained | License evidence |
| --- | --- | --- |
| Windows npm dependency | `ws` 8.21.3, installed during explicit setup | MIT text and integrity in the inventory |
| Server npm dependencies | 89 locked entries, installed during explicit setup | MIT, ISC, BSD-3-Clause and Apache-2.0 declarations; complete actual notices retained |
| MCP SDK | Server-side protocol implementation | Upstream Apache-2.0/MIT transition notice retained in full, including documentation CC-BY-4.0 terms |
| .NET 10.0.8 Windows Desktop | Included in the self-contained GUI | Runtime licenses and bundled third-party notices in `licenses/dotnet-*` |
| Go standard library | Compiled into the core | `licenses/GO-LICENSE.txt` |
| Node 24.21.0 | Official portable archive when compatible Node is absent | SHA-256 verified; archive retains its LICENSE |
| OpenSSH and Linux prerequisites | Operating-system packages, not bundled application source | Distribution packages retain their own copyright/license records |

Review date: 2026-10-18. Both npm lockfiles currently report zero known vulnerabilities with `npm audit`. This is a point-in-time advisory check, not proof that no vulnerabilities exist. Missing/unrecognized license metadata was removed with the old execution dependency tree; no missing license is waived in the current inventory.

`licenses/npm-inventory.json` records each exact version, registry URL, archive integrity and license-file hash. `licenses/npm-THIRD-PARTY.txt` contains unmodified upstream license texts, including copyright holders. The build verifies this inventory. CI additionally installs both lockfiles without lifecycle scripts, compares the actual license texts and runs npm audit.

Dependency changes require reviewing the exact package origin, source changes, license and any installation hooks. `python tools/check_dependencies.py --record` is an explicit maintainer operation after that review; CI and release packaging never run it. Unknown licenses, local/file dependencies, missing integrity and lifecycle hooks are rejected. Do not remove an author's notices or label third-party code as original MIT project code.

Primary sources: [MCP SDK license](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE), [ws 8.21.3 license](https://github.com/websockets/ws/blob/8.21.3/LICENSE), [Go license](https://go.dev/LICENSE), [.NET runtime license](https://github.com/dotnet/runtime/blob/main/LICENSE.TXT).
