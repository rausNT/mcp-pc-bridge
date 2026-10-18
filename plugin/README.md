# Plugin template

This archive is not a ready-to-use hosted service. The `mcp.example.invalid` address deliberately does not work.
Deploy your own server, then run `tools/package_plugin.py --url https://YOUR-LOWERCASE-DOMAIN/mcp --output dist/my-plugin.zip` from the source root.
The builder changes the endpoint in both MCP manifests; no credentials should be put in the archive.

The package includes the agent-plugin manifest, Codex-compatible manifest and an authorized-computer-work skill.
Installing the package and configuring OAuth in ChatGPT are separate actions. Account/workspace support must be checked against current OpenAI documentation.
OAuth client credentials are entered in the platform's connection settings, not placed in plugin JSON, URLs, repository files or chat messages.

A configured package is personal to the operator's own server. Public releases should contain only the placeholder template.
Read SECURITY.md at the repository root. Broad shell/file access is experimental; a plugin skill is not an enforceable sandbox or a local approval broker.
