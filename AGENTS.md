# Repository guide

This is an agent-oriented TypeScript CLI wrapping the remote Sentry MCP server.

## Stack and commands

- Node.js 24+ runs TypeScript source directly; do not add a transpiled build artifact.
- Install with `npm ci` or `mise run setup`.
- Run all code checks with `npm run check` or `mise run check`.
- Individual checks: `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. Use `npm run format` to rewrite files.
- After package-content changes, also run `npm pack --dry-run`.
- Never use `npx -y`; add required tooling to `devDependencies`.

## Architecture

- `bin/sentry-axi.ts` is the executable entry point.
- `src/cli.ts` registers AXI commands and builds the MCP runtime.
- `src/catalog.ts` is the declarative mapping from CLI actions to Sentry MCP tools. Keep shared parsing and repository-default behavior in `src/commands/catalog.ts`.
- `src/mcp.ts` owns remote transport, OAuth persistence, and token header semantics.
- `src/repo.ts` owns `.sentry-project` discovery, validation, and endpoint constraints.
- `src/output.ts` owns compact results, field selection, truncation, and binary file writes.
- `src/skill.ts` generates `skills/sentry-axi/SKILL.md` through `npm run build:skill`; commit both source and generated changes.

## Contracts

- Preserve agent-readable structured stdout. Errors must include a useful recovery hint.
- Default remote endpoint: `https://mcp.sentry.dev/mcp`.
- `SENTRY_AXI_MCP_TOKEN` uses `Bearer`; `SENTRY_ACCESS_TOKEN` uses `Sentry-Bearer`; reject simultaneous configuration.
- Never print tokens or saved OAuth credentials. Keep credential files at mode `0600`.
- Respect organization/project constraints encoded in the endpoint before repository defaults.
- Require `--output` before writing attachment or image bytes; never emit binary data to stdout.
- Treat create and update commands as mutations. Do not add implicit retries that could duplicate a mutation.

## Change workflow

- Add or update catalog and output tests when changing a tool mapping, flag conversion, default, or response policy.
- Prefer table-driven catalog coverage over one handler per MCP tool.
- Keep dependencies and abstractions minimal.
- Format with Oxfmt and lint with Oxlint; do not hand-format around their output.
- Make small conventional commits with a short body describing what changed and why.
- Never publish locally or create release tags unless explicitly requested; tagged CI performs publishing.
