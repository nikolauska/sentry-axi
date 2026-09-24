# Repository guide

This is a TypeScript CLI for agents working with Sentry through its remote MCP server. Use `CONTRIBUTING.md` for setup and validation details; use `docs/domain/how-sentry-axi-works.md` when changing product behavior.

## Where to change behavior

- `src/cli.ts` registers commands; `src/catalog.ts` maps CLI actions to MCP tools. Keep shared parsing and repository defaults in `src/commands/catalog.ts`.
- `src/mcp.ts` owns transport, OAuth persistence, and token headers; `src/repo.ts` owns `.sentry-project` and endpoint scope; `src/output.ts` owns result shaping and binary writes.
- When changing the agent skill, edit `src/skill.ts`, run `npm run build:skill`, and include the generated `skills/sentry-axi/SKILL.md`. Do not edit the generated file directly.

## Behavior to preserve

- Keep stdout structured for agents and errors actionable. Default to `https://mcp.sentry.dev/mcp`.
- `SENTRY_AXI_MCP_TOKEN` uses `Bearer`; `SENTRY_ACCESS_TOKEN` uses `Sentry-Bearer`. Reject both together. Never expose tokens or saved OAuth credentials; credential files must remain mode `0600`.
- Endpoint organization/project constraints take precedence over repository defaults. Require `--output` for attachment and image bytes; never write binary data to stdout.
- Treat creates and updates as mutations: never retry automatically after an ambiguous failure that could duplicate an operation.

## Working locally

- Use Node.js 24+ and `npm ci` for setup. Choose focused checks for the changed behavior; `npm run check` runs formatting, lint, typecheck, generated-skill verification, and tests. Use `npm run format` for Oxfmt formatting rather than hand-formatting around it.
- For tool mappings, flags, defaults, or response policy changes, update catalog/output tests as appropriate; prefer table-driven catalog coverage.
- For package-content changes, run `npm run build` and `npm pack --dry-run` to inspect the published contents.
- Keep dependencies and abstractions minimal. Make small conventional commits with a short body explaining why. Do not publish or create release tags without an explicit request; tagged CI publishes releases.
