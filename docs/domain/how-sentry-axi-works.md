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

Login waits up to five minutes for the browser to return to a local callback. When the shell cannot wait, `sentry-axi auth login --manual` prints the URL and `sentry-axi auth finish --code <code>` completes the sign-in.

`sentry-axi --help` is the usage guide for agents and people alike; the [sentry-axi skill](../../skills/sentry-axi/SKILL.md) only tells agents to read it. Optional session hooks can provide repository context automatically at the start of a supported agent session:

```sh
sentry-axi setup hooks
sentry-axi setup hooks status
sentry-axi setup hooks remove
```

The hook setup is explicit and safe to rerun. It installs or repairs user-level session hooks for Claude Code, Codex, and OpenCode, and reports success only after confirming the hooks are on disk. Codex also needs `[features] hooks = true` in `~/.codex/config.toml`; setup turns it on, and removal leaves it in place because other tools may rely on it.

## Connect to Sentry

The default endpoint is Sentry's hosted MCP service and uses OAuth. A custom endpoint may use either an MCP access token or a Sentry API token, but the two token types cannot be configured together.

After authentication, commands run against the organizations and projects available to those credentials. An MCP endpoint can further constrain the organization or project, and sentry-axi rejects conflicting command flags or repository defaults.

## Choose the working scope

An AI agent can bind a Git repository to a default Sentry organization and project. sentry-axi checks that both slugs exist exactly as written before saving them in `.sentry-project`; a near match is reported as not found together with the similar slugs Sentry returned.

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

sentry-axi returns compact output designed to reduce the tokens an AI agent needs to understand and act on Sentry data. Structured results are printed as TOON. Many Sentry answers, such as issue details and searches, are markdown; those are printed as markdown, with mentions of Sentry MCP tools rewritten to the matching `sentry-axi` command. List commands show each row's simple fields and name the nested fields they hide. When Sentry reports more rows or a next-page cursor, or a page fills the limit, the output says how to get the rest. Long text is previewed up to 6000 characters, selected fields can be requested with `--select`, and complete content can be requested with `--full`. A `--select` that would match nothing fails with the available fields instead of printing an empty result.

Every action documents its flags with `sentry-axi <group> <action> --help`.

Errors include practical recovery suggestions, such as authenticating, selecting a valid repository scope, correcting a command, or inspecting a resource. Connection and server failures are summarized rather than echoing the raw response.

Creating and updating Sentry data requires explicit user intent. If a mutation fails after it may have reached Sentry, the agent inspects the target before retrying rather than assuming the first attempt was rolled back.
