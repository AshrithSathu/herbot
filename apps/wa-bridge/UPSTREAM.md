# Upstream

This directory is a vendored copy of the Go bridge from
[verygoodplugins/whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp),
a maintained fork of [lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp).
MIT licensed. See `LICENSE`.

- Source path: `whatsapp-bridge/`
- Upstream commit: `a1af56c43a8e8ec4196f4c65e520a12d44bf79cc` (2026-10-25)
- Not vendored: the Python MCP server. Herbot bot threads get group-scoped tools from `crates/herbot-mcp` instead.

Herbot's changes are kept in separate commits on top of the vendored copy, and listed in `README.md`. To pull upstream fixes later, diff against the commit above.
