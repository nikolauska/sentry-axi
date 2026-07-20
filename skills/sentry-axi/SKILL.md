---
name: sentry-axi
description: "Operate Sentry through the sentry-axi CLI: issues, events, traces, replays, releases, projects, alerts, dashboards, monitors, profiles, snapshots, and Sentry docs. Use whenever a task needs Sentry investigation or an explicit Sentry mutation. Do not use for other observability providers."
---

# sentry-axi

Agent-friendly wrapper around the configured Sentry MCP server. Prefer it over raw Sentry MCP calls.

When the native `sentry_axi` tool is available, prefer it over shell execution and pass the CLI command group as `action` plus the remaining command arguments as `args`. Otherwise, check whether `sentry-axi` is installed before using it. If missing, ask the user to install the pi package with `pi install npm:@nikolauska/sentry-axi` or the standalone CLI globally with `npm install -g @nikolauska/sentry-axi`. Node.js 24 or newer is required.

## Workflow

1. Use `sentry_axi` with `action: "dashboard"`, or run `sentry-axi` with no arguments, to inspect authentication and repository context.
2. If needed, run `sentry-axi auth login`. Never print access tokens or saved OAuth credentials.
3. Bind a Git repository with `sentry-axi init --organization <slug> --project <slug>`. Commands then use `.sentry-project` defaults; pass `--all-projects` only when broad scope is intended.
4. Start with compact search or list commands, then drill into a specific issue, event, trace, replay, profile, or resource.
5. Use `--select <field,...>` to narrow structured results and `--full` only when truncation hides needed content.
6. Binary attachment and snapshot-image commands require `--output <path>`.
7. Before creating or updating Sentry data, confirm the exact target unless the user already requested that mutation. After an uncertain transport failure, inspect the target before retrying.

## Commands

- organizations: list
- projects: list, create, update, add-team, remove-team
- teams: list, create
- dsns: list, create, update
- issues: search, view, update, activity, tags, reports, events, stacktrace, note, analyze
- events: search
- attachments: list, download
- traces: view
- replays: view
- releases: list, view
- dashboards: list, view
- monitors: list, view
- alerts: list, view
- docs: search, view
- profiles: analyze, view
- resources: view
- snapshots: latest, view, image
- conversations: search, view
- tools: search, run

Use `sentry-axi --help`, `sentry-axi <group> --help`, or `sentry-axi <group> <action> --help` for flags. Use `sentry-axi tools search <query>` and `sentry-axi tools run <name> --arguments '<json>'` for server tools not yet exposed directly.

Native tool example: `{"action":"issues","args":["search","unresolved errors","--limit","10"]}` corresponds to `sentry-axi issues search "unresolved errors" --limit 10`.
