# How sentry-axi works

sentry-axi is an [Agent eXperience Interface (AXI)](https://github.com/kunchenguid/axi) for Sentry. It gives AI agents a command-line interface for investigating and managing Sentry data through a configured MCP endpoint.

AXI tools are designed for AI agents rather than human-first terminal use. sentry-axi turns Sentry operations into compact, resource-based commands with structured output, predictable errors, and contextual next steps.

## Install sentry-axi

sentry-axi requires Node.js 24 or newer. Install the command globally with npm:

```sh
npm install -g @nikolauska/sentry-axi
```

Confirm that the command is available:

```sh
sentry-axi --help
```

The CLI connects to Sentry's hosted MCP endpoint by default. When the endpoint requires authorization, sign in with:

```sh
sentry-axi auth login
```

For agent-specific setup and usage, see the [sentry-axi skill](../../skills/sentry-axi/SKILL.md). Optional session hooks can provide repository context automatically at the start of a supported agent session:

```sh
sentry-axi setup hooks
```

The hook setup is explicit and safe to rerun. It installs or repairs user-level session hooks for Claude Code, Codex, and OpenCode.

## Connect to Sentry

The default endpoint is Sentry's hosted MCP service and uses OAuth. A custom endpoint may use either an MCP access token or a Sentry API token, but the two token types cannot be configured together.

After authentication, commands run against the organizations and projects available to those credentials. An MCP endpoint can further constrain the organization or project, and sentry-axi rejects conflicting command flags or repository defaults.

## Choose the working scope

An AI agent can bind a Git repository to a default Sentry organization and project. sentry-axi validates both before saving them in `.sentry-project`.

Commands use the repository defaults when organization or project flags are omitted. Commands that support broader searches require the agent to select `--all-projects` explicitly.

This keeps routine investigations focused on the service associated with the current repository without preventing deliberate searches across projects.

## Investigate and manage Sentry data

Commands are grouped by the Sentry resource they affect. AI agents can:

- investigate issues, events, stack traces, traces, replays, profiles, and conversations;
- inspect releases, dashboards, monitors, alerts, snapshots, attachments, and project DSNs;
- list and manage organizations, projects, and teams;
- search Sentry documentation and inspect server resources;
- discover and run MCP tools that the server exposes before sentry-axi adds a direct command.

Binary attachments and snapshot images are written only to an explicit output path. They are never emitted as terminal output.

## Read results and recover safely

sentry-axi returns compact, structured output designed to reduce the tokens an AI agent needs to understand and act on Sentry data. Large text is previewed by default, selected fields can be requested with `--select`, and complete content can be requested with `--full`.

Errors include practical recovery suggestions, such as authenticating, selecting a valid repository scope, correcting a command, or inspecting a resource.

Creating and updating Sentry data requires explicit user intent. If a mutation fails after it may have reached Sentry, the agent inspects the target before retrying rather than assuming the first attempt was rolled back.
