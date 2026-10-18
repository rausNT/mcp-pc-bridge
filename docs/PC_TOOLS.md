# Built-in PC tools

This preview implements eight local tools in original MIT project code. Desktop Commander is not required, installed or bundled. Tool names are intentionally separate from that product's API; existing prompts using its tool names must use this list instead.

| Tool | Behavior |
| --- | --- |
| `pc_read_file` | Bounded UTF-8/base64 reads with byte offsets, up to 1 MiB per call |
| `pc_write_file` | UTF-8 writes up to 1 MiB; create by default, explicit `overwrite` to replace |
| `pc_list_directory` | Nonrecursive listing, at most 1,000 entries |
| `pc_file_info` | Metadata; identifies the final symlink without following it |
| `pc_make_directory` | Create a directory; optional explicit parent creation |
| `pc_start_process` | PowerShell command in an absolute working directory; returns a job ID |
| `pc_read_process` | Job state and retained output, with byte cursors and truncation disclosure |
| `pc_stop_process` | Attempt to stop the agent-owned direct child by job ID |

`dc_remote_status` is the relay's existing status tool name, retained for protocol compatibility. It does not load Desktop Commander.

Commands run as the Windows user and can use files, network, Python or other installed executables with those permissions. This is **not** a restricted-folder mode. Process limits are four active jobs, sixteen retained job records, 256 KiB retained output per job, 64 KiB per output read and a 30-second default/120-second maximum deadline. Timeouts and stop only attempt to terminate the direct child. Detached children may survive; do not treat this as the SEC-03 emergency-stop guarantee.

Job records and request deduplication are in memory. After agent restart an unknown job returns `OUTCOME_UNKNOWN`; inspect resulting files/process state instead of rerunning a possible write. The relay never automatically retries commands after losing a result. File errors can leave partial changes. Overwrite is an explicit argument, not an independent local approval or an atomic transaction.

No dedicated PDF/Office conversion, image manipulation, screenshot, browser control or interactive terminal API is claimed. Those former dependency capabilities are not silently advertised as implemented. Installed applications can be invoked through PowerShell when the owner authorizes it. The Linux shell branch exists for portable tests/development; Windows uses the system Windows PowerShell executable.
