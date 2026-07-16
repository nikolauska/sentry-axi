# sentry-axi

Agent-friendly TypeScript CLI for the [Sentry MCP server](https://mcp.sentry.dev/mcp). It exposes Sentry investigation and operation workflows as predictable shell commands with compact structured output, repository defaults, OAuth support, and explicit binary destinations.

## Requirements

- Node.js 24 or newer
- A Sentry account with access to the target organization and projects

## Install

```sh
npm install --global @nikolauska/sentry-axi
sentry-axi auth login
```

The package also contains matching Codex and Claude plugin manifests and the `sentry-axi` Agent Skill under `skills/`.

## Quick start

```sh
# Inspect authentication and current repository context
sentry-axi

# Bind the current Git repository to a default Sentry project
sentry-axi init --organization acme --project web

# Investigate
sentry-axi issues search "unresolved errors"
sentry-axi issues view ISSUE_ID
sentry-axi traces view TRACE_ID
sentry-axi events search "count()" --fields count --dataset errors

# Download binary content only to an explicit path
sentry-axi attachments download EVENT_ID \
  --organization acme --project web --attachment-id ATTACHMENT_ID \
  --output artifact.bin
```

Run `sentry-axi --help`, `sentry-axi <group> --help`, or `sentry-axi <group> <action> --help` for focused usage. The CLI covers organizations, projects, teams, DSNs, issues, events, attachments, traces, replays, releases, dashboards, monitors, alerts, docs, profiles, resources, snapshots, conversations, and Sentry tool discovery.

## Authentication and endpoint configuration

By default, sentry-axi connects to `https://mcp.sentry.dev/mcp` and uses MCP OAuth. Login credentials are saved with mode `0600` under `$XDG_CONFIG_HOME/sentry-axi/oauth.json` or `~/.config/sentry-axi/oauth.json`.

```sh
sentry-axi auth login
sentry-axi auth login --manual
sentry-axi auth finish --code CODE
sentry-axi auth whoami
sentry-axi auth logout
```

Environment variables:

| Variable               | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `SENTRY_AXI_MCP_URL`   | Override the MCP endpoint                 |
| `SENTRY_AXI_MCP_TOKEN` | MCP OAuth access token, sent as `Bearer`  |
| `SENTRY_ACCESS_TOKEN`  | Sentry API token, sent as `Sentry-Bearer` |
| `SENTRY_AXI_AUTH_FILE` | Override the saved OAuth credential path  |

The two token variables are mutually exclusive. When no URL override is present, sentry-axi also recognizes the `mcp_servers.sentry` URL in the Codex TOML config. Scoped endpoints such as `/mcp/<organization>/<project>` constrain commands and reject conflicting flags or repository bindings.

## Repository context and output

`sentry-axi init` validates the organization and project before writing `.sentry-project` at the Git root. Commands use those values when their flags are omitted. Pass `--all-projects` only on commands where project scope is optional.

Results are structured for agent consumption. Long strings are previewed at 1,500 characters; add `--full` for complete content or `--select id,title` to project fields. Attachments and snapshot images require `--output <path>` and never emit binary bytes to stdout.

Create and update commands are direct mutations. Agents should confirm their target unless the user already requested that exact action, and inspect the target before retrying after an uncertain transport failure.

## Development

[mise](https://mise.jdx.dev/) installs Node 24 and exposes the local workflow:

```sh
mise install
mise run setup
mise run check
```

The same checks are available through npm:

```sh
npm ci
npm run format       # Oxfmt
npm run lint         # Oxlint
npm run typecheck
npm run build         # Emit publishable JavaScript to dist/
npm test
npm run check
```

Development source runs directly as TypeScript. `npm run build` emits the JavaScript published from `dist/`. Update `src/skill.ts` or the command catalog, then run `npm run build:skill` and commit the generated `skills/sentry-axi/SKILL.md`.

## License

MIT
